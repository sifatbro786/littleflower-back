import { audit } from "#core/audit.js";
import { badRequest, conflict, forbidden, notFound } from "#core/errors.js";
import { addDays, dhakaDateString, dhakaTimeString, fromDbDate, toDbDate, weekdayOf } from "#core/dates.js";
import { logger } from "#core/logger.js";
import { prisma, tx } from "#core/prisma.js";
import { enqueue, QUEUES } from "#core/queue.js";
import { can, ROLE_KEYS } from "#core/rbac.js";

import { findSection, getCurrentSession, sectionLabel, sectionScope } from "#modules/academics/academics.service.js";
import { smsCutoff, weeklyOff } from "#modules/settings/settings.service.js";
import { currentEnrollment, sectionRoster } from "#modules/students/students.service.js";

/**
 * Attendance (PRD §6.4). One row per enrollment per Dhaka DATE. Everyone starts present in the UI;
 * saving upserts the whole sheet. Absent SMS: one job per section per day, run at the cutoff
 * (corrections before then send nothing); per-student dedupe in SmsLog makes re-runs safe.
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */
/** @typedef {import("#core/auth.js").AuthUser} AuthUser */

/** Teachers can correct the last 7 days; attendance.view holders any day of the session. */
const TEACHER_EDIT_DAYS = 7;
const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : null);

/* ------------------------------ calendar ------------------------------ */

async function holidayMap(from, to) {
    const rows = await prisma.holiday.findMany({ where: { date: { gte: toDbDate(from), lte: toDbDate(to) } } });
    return new Map(rows.map((h) => [fromDbDate(h.date), h.title]));
}

/** @returns {Promise<(iso: string) => { school: boolean, holiday: string | null }>} */
async function calendar(from, to) {
    const [off, holidays] = await Promise.all([weeklyOff(), holidayMap(from, to)]);
    const offSet = new Set(off);
    return (iso) => {
        const holiday = holidays.get(iso) ?? null;
        return { school: !offSet.has(weekdayOf(iso)) && !holiday, holiday };
    };
}

/** Last n school days up to and including `until` (newest last). */
export async function recentSchoolDays(n, until = dhakaDateString()) {
    const from = addDays(until, -(n * 3 + 14));
    const cal = await calendar(from, until);
    const out = [];
    for (let d = until; out.length < n && d >= from; d = addDays(d, -1)) if (cal(d).school) out.unshift(d);
    return out;
}

async function schoolDaysBetween(from, to) {
    if (to < from) return [];
    const cal = await calendar(from, to);
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (cal(d).school) out.push(d);
    return out;
}

/* ------------------------------ scope ------------------------------ */

/** Teachers only their sections; others need attendance.take or attendance.view. 404 outside scope. */
async function assertSection(user, sectionId) {
    const scope = await sectionScope(user);
    if (scope && !scope.has(sectionId)) throw notFound();
    if (!scope && !can(user, "attendance.take") && !can(user, "attendance.view")) throw forbidden();
}

/* ------------------------------ sheet ------------------------------ */

export async function getSheet(sectionId, date = dhakaDateString(), user) {
    if (user) await assertSection(user, sectionId);
    const section = await findSection(sectionId);
    if (!section) throw notFound();
    const [roster, cal, cutoff] = await Promise.all([sectionRoster(sectionId), calendar(date, date), smsCutoff()]);
    const marks = await prisma.attendance.findMany({ where: { date: toDbDate(date), enrollmentId: { in: roster.map((r) => r.enrollmentId) } }, select: { enrollmentId: true, status: true } });
    const status = new Map(marks.map((m) => [m.enrollmentId, m.status]));
    const day = cal(date);
    return {
        sectionId,
        section: sectionLabel(section),
        date,
        isSchoolDay: day.school,
        holiday: day.holiday,
        taken: marks.length > 0,
        smsCutoff: cutoff,
        rows: roster.map((r) => ({ ...r, status: status.get(r.enrollmentId) ?? null })),
    };
}

/** Minutes since midnight for "HH:mm". */
const minutes = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Upserts a whole sheet. Returns counts and when the absent SMS goes (today only). */
export async function saveSheet({ sectionId, date, entries }, user, ctx) {
    await assertSection(user, sectionId);
    if (!can(user, "attendance.take") && !can(user, "attendance.view")) throw forbidden();
    const today = dhakaDateString();
    if (date > today) throw badRequest("Attendance cannot be taken for a future date.");
    const session = await getCurrentSession();
    if (date < session.startDate.toISOString().slice(0, 10) || date > session.endDate.toISOString().slice(0, 10)) throw badRequest("This date is outside the current session.");
    if (!can(user, "attendance.view") && date < addDays(today, -TEACHER_EDIT_DAYS)) throw forbidden(`Teachers can correct attendance for the last ${TEACHER_EDIT_DAYS} days. Ask the office for older changes.`);
    const day = (await calendar(date, date))(date);
    if (!day.school) throw conflict(day.holiday ? `${date} is a holiday (${day.holiday}).` : `${date} is a weekly holiday.`);

    const roster = await sectionRoster(sectionId, session.id);
    const valid = new Set(roster.map((r) => r.enrollmentId));
    if (entries.some((e) => !valid.has(e.enrollmentId))) throw badRequest("Some students are not in this class.");
    const dbDate = toDbDate(date);

    const existing = await prisma.attendance.count({ where: { date: dbDate, enrollmentId: { in: [...valid] } } });
    await tx(async (t) => {
        for (const e of entries) {
            await t.attendance.upsert({
                where: { enrollmentId_date: { enrollmentId: e.enrollmentId, date: dbDate } },
                create: { enrollmentId: e.enrollmentId, date: dbDate, status: e.status, note: e.note ?? null, takenById: user.id },
                update: { status: e.status, note: e.note ?? null, takenById: user.id },
            });
        }
        // Audit corrections (re-saves); first takes are routine and would only flood the log.
        if (existing > 0) {
            const section = roster.length ? (await findSection(sectionId)) : null;
            await audit(ctx, { action: "attendance.update", entity: "Attendance", entityId: sectionId, after: { detail: `Corrected attendance for ${section ? sectionLabel(section) : "a section"} on ${date}` } }, t);
        }
    });

    const counts = entries.reduce((a, e) => ((a[e.status] = (a[e.status] ?? 0) + 1), a), { PRESENT: 0, ABSENT: 0, LATE: 0 });
    let smsAt = null;
    if (date === today && counts.ABSENT > 0) smsAt = await scheduleAbsentSms(sectionId, date);
    return { present: counts.PRESENT, absent: counts.ABSENT, late: counts.LATE, smsAt };
}

/**
 * Before the cutoff: one delayed job per section/day (jobId dedupes repeated saves; it reads the
 * sheet as it is at the cutoff). After the cutoff: a job right away; SmsLog.dedupeKey ensures each
 * guardian still gets at most one absent SMS per day.
 */
async function scheduleAbsentSms(sectionId, date) {
    const cutoff = await smsCutoff();
    const now = dhakaTimeString();
    try {
        if (minutes(now) < minutes(cutoff)) {
            const delay = (minutes(cutoff) - minutes(now)) * 60_000 - new Date().getSeconds() * 1000;
            await enqueue(QUEUES.SMS, "absent.section", { sectionId, date }, { jobId: `absent:${sectionId}:${date}`, delay: Math.max(delay, 0) });
        } else {
            await enqueue(QUEUES.SMS, "absent.section", { sectionId, date }, { jobId: `absent:${sectionId}:${date}:${Date.now()}` });
        }
    } catch (err) {
        logger.error({ err: err.message, sectionId, date }, "could not queue absent SMS");
        return null;
    }
    return minutes(now) < minutes(cutoff) ? cutoff : "now";
}

/** For the SMS worker: students marked ABSENT on that date (still absent when the job runs). */
export async function absentees(sectionId, date) {
    const roster = await sectionRoster(sectionId);
    const section = await findSection(sectionId);
    const absent = await prisma.attendance.findMany({ where: { date: toDbDate(date), status: "ABSENT", enrollmentId: { in: roster.map((r) => r.enrollmentId) } }, select: { enrollmentId: true } });
    const ids = new Set(absent.map((a) => a.enrollmentId));
    return roster.filter((r) => ids.has(r.enrollmentId)).map((r) => ({ ...r, className: section ? sectionLabel(section) : "" }));
}

/* ------------------------------ reports ------------------------------ */

export async function summary(date = dhakaDateString()) {
    const session = await getCurrentSession();
    const sections = await prisma.section.findMany({ where: { class: { isActive: true } }, include: { class: { select: { name: true, order: true } } } });
    sections.sort((a, b) => a.class.order - b.class.order || a.name.localeCompare(b.name));
    const [rosterCounts, marks] = await Promise.all([
        prisma.enrollment.groupBy({ by: ["sectionId"], where: { sessionId: session.id, student: { status: "ACTIVE" } }, _count: { _all: true } }),
        prisma.$queryRaw`SELECT e."sectionId", a.status, COUNT(*)::int AS n FROM "Attendance" a JOIN "Enrollment" e ON e.id = a."enrollmentId" WHERE a.date = ${toDbDate(date)} AND e."sessionId" = ${session.id}::uuid GROUP BY 1, 2`,
    ]);
    const total = new Map(rosterCounts.map((r) => [r.sectionId, r._count._all]));
    const by = new Map();
    for (const m of marks) by.set(`${m.sectionId}|${m.status}`, Number(m.n));
    const rows = sections.map((s) => {
        const present = by.get(`${s.id}|PRESENT`) ?? 0;
        const late = by.get(`${s.id}|LATE`) ?? 0;
        const absent = by.get(`${s.id}|ABSENT`) ?? 0;
        return { sectionId: s.id, section: sectionLabel(s), total: total.get(s.id) ?? 0, present, late, absent, taken: present + late + absent > 0 };
    });
    const taken = rows.filter((r) => r.taken);
    const here = taken.reduce((a, r) => a + r.present + r.late, 0);
    const counted = taken.reduce((a, r) => a + r.present + r.late + r.absent, 0);
    return { date, sections: rows, rate: pct(here, counted), pending: rows.filter((r) => !r.taken && r.total > 0).map((r) => r.section) };
}

export async function trend(n = 14) {
    const session = await getCurrentSession();
    const days = await recentSchoolDays(n);
    if (!days.length) return [];
    const rows = await prisma.$queryRaw`
        SELECT a.date, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE a.status <> 'ABSENT')::int AS here
        FROM "Attendance" a JOIN "Enrollment" e ON e.id = a."enrollmentId"
        WHERE e."sessionId" = ${session.id}::uuid AND a.date >= ${toDbDate(days[0])} AND a.date <= ${toDbDate(days.at(-1))}
        GROUP BY a.date`;
    const m = new Map(rows.map((r) => [fromDbDate(r.date), r]));
    return days.map((date) => ({ date, rate: m.has(date) ? pct(m.get(date).here, m.get(date).total) : null }));
}

export async function monthlyReport(sectionId, month, user) {
    if (user) await assertSection(user, sectionId);
    const today = dhakaDateString();
    const [y, mo] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const days = await schoolDaysBetween(`${month}-01`, last < today ? last : today);
    const roster = await sectionRoster(sectionId);
    const marks = days.length
        ? await prisma.attendance.groupBy({ by: ["enrollmentId", "status"], where: { enrollmentId: { in: roster.map((r) => r.enrollmentId) }, date: { gte: toDbDate(`${month}-01`), lte: toDbDate(last) } }, _count: { _all: true } })
        : [];
    const c = new Map(marks.map((m) => [`${m.enrollmentId}|${m.status}`, m._count._all]));
    return {
        days: days.length,
        rows: roster.map((r) => {
            const p = c.get(`${r.enrollmentId}|PRESENT`) ?? 0;
            const l = c.get(`${r.enrollmentId}|LATE`) ?? 0;
            const a = c.get(`${r.enrollmentId}|ABSENT`) ?? 0;
            const t = p + l + a;
            return { roll: r.roll, name: r.name, present: p, late: l, absent: a, rate: t ? Math.round(((p + l) / t) * 100) : 0 };
        }),
    };
}

/** Month calendar for one student (portal + profile). Own child only for guardians. */
export async function studentMonth(studentId, month, user) {
    const en = await currentEnrollment(studentId);
    if (!en) throw notFound();
    if (user) {
        if (user.role === ROLE_KEYS.STUDENT) {
            if (user.studentId !== studentId) throw notFound();
        } else if (can(user, "attendance.view") || can(user, "attendance.take")) await assertSection(user, en.sectionId);
        else if (!can(user, "students.view")) throw forbidden(); // e.g. Accountant on a student profile: read only
    }
    const today = dhakaDateString();
    const [y, mo] = month.split("-").map(Number);
    const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const from = `${month}-01`;
    const to = `${month}-${String(n).padStart(2, "0")}`;
    const [cal, marks] = await Promise.all([calendar(from, to), prisma.attendance.findMany({ where: { enrollmentId: en.id, date: { gte: toDbDate(from), lte: toDbDate(to) } }, select: { date: true, status: true } })]);
    const st = new Map(marks.map((m) => [fromDbDate(m.date), m.status]));
    const days = Array.from({ length: n }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, "0")}`;
        const c = cal(date);
        return { date, status: st.get(date) ?? null, schoolDay: c.school, holiday: c.holiday, future: date > today };
    });
    const counted = days.filter((d) => d.status);
    return {
        month,
        days,
        present: counted.filter((d) => d.status === "PRESENT").length,
        late: counted.filter((d) => d.status === "LATE").length,
        absent: counted.filter((d) => d.status === "ABSENT").length,
        workingDays: days.filter((d) => d.schoolDay && !d.future).length,
    };
}

/** For the student profile. */
export async function enrollmentAttendanceSummary(enrollmentId) {
    const rows = await prisma.attendance.groupBy({ by: ["status"], where: { enrollmentId }, _count: { _all: true } });
    const get = (s) => rows.find((r) => r.status === s)?._count._all ?? 0;
    const present = get("PRESENT");
    const absent = get("ABSENT");
    const late = get("LATE");
    const taken = present + absent + late;
    return { present, absent, late, rate: taken ? Math.round(((present + late) / taken) * 1000) / 10 : 0 };
}

/* ------------------------------ holidays ------------------------------ */

export async function listHolidays() {
    const session = await getCurrentSession();
    const rows = await prisma.holiday.findMany({ where: { date: { gte: session.startDate, lte: session.endDate } }, orderBy: { date: "asc" } });
    return rows.map((h) => ({ date: fromDbDate(h.date), title: h.title }));
}

/** A range becomes one row per day (existing days are renamed). */
export async function addHolidays({ from, to, title }, ctx) {
    const end = to ?? from;
    const days = [];
    for (let d = from; d <= end && days.length < 60; d = addDays(d, 1)) days.push(d);
    await tx(async (t) => {
        for (const d of days) await t.holiday.upsert({ where: { date: toDbDate(d) }, create: { date: toDbDate(d), title }, update: { title } });
        await audit(ctx, { action: "attendance.holiday", entity: "Holiday", entityId: from, after: { detail: `Holiday "${title}" ${from}${end !== from ? ` to ${end}` : ""}` } }, t);
    });
    return listHolidays();
}

export async function removeHoliday(date, ctx) {
    const { count } = await prisma.holiday.deleteMany({ where: { date: toDbDate(date) } });
    if (!count) throw notFound();
    await audit(ctx, { action: "attendance.holiday_delete", entity: "Holiday", entityId: date, after: { detail: `Removed holiday on ${date}` } });
    return listHolidays();
}
