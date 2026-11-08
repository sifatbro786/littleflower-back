import { audit } from "#core/audit.js";
import { badRequest, conflict, notFound } from "#core/errors.js";
import { dhakaDateString, weekdayOf } from "#core/dates.js";
import { prisma, tx } from "#core/prisma.js";
import { ROLE_KEYS } from "#core/rbac.js";

import { activeStaff, findSection, getCurrentSession, listPeriods, routineOptions, sectionLabel, subjectOfClass } from "#modules/academics/academics.service.js";
import { staffOptions } from "#modules/staff/staff.service.js";
import { weeklyOff } from "#modules/settings/settings.service.js";
import { currentEnrollment } from "#modules/students/students.service.js";

/**
 * Class routine (PRD §6.5). Stored per section; a teacher's routine is a query over the same rows.
 * DB uniques stop a section having two subjects in one period and a teacher being in two places.
 */

const WEEK = ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"];
const DAY_NAME = { SAT: "Saturday", SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday" };

async function schoolDays() {
    const off = new Set(await weeklyOff());
    return WEEK.filter((d) => !off.has(d));
}

const slotInclude = { subject: { select: { id: true, name: true } }, staff: { select: { id: true, name: true } }, section: { include: { class: { select: { name: true } } } } };
const toCell = (s) => ({ day: s.day, periodId: s.periodId, subject: s.subject.name, subjectId: s.subjectId, teacher: s.staff?.name ?? "—", staffId: s.staffId, section: sectionLabel(s.section), sectionId: s.sectionId });

/** { title, days, periods, cells } (lib/dashboard/routine getRoutine). Guardians: own child's section only. */
export async function getRoutine({ sectionId, staffId }, user) {
    if (user?.role === ROLE_KEYS.STUDENT) {
        const en = user.studentId ? await currentEnrollment(user.studentId) : null;
        if (!en || staffId || sectionId !== en.sectionId) throw notFound();
    }
    const session = await getCurrentSession();
    let title;
    if (sectionId) {
        const sec = await findSection(sectionId);
        if (!sec) throw notFound();
        title = sectionLabel(sec);
    } else {
        const st = await prisma.staff.findUnique({ where: { id: staffId }, select: { name: true } });
        if (!st) throw notFound();
        title = st.name;
    }
    const [days, periods, slots] = await Promise.all([schoolDays(), listPeriods(), prisma.routineSlot.findMany({ where: { sessionId: session.id, ...(sectionId ? { sectionId } : { staffId }) }, include: slotInclude })]);
    return { title, days, periods: periods.map((p) => ({ id: p.id, number: p.number, start: p.startTime, end: p.endTime })), cells: slots.map(toCell) };
}

/** Today's classes for a teacher, by period (teacher home). */
export async function teacherToday(staffId, isoDate = dhakaDateString()) {
    const session = await getCurrentSession();
    const slots = await prisma.routineSlot.findMany({ where: { sessionId: session.id, staffId, day: weekdayOf(isoDate) }, include: { ...slotInclude, period: true } });
    return slots
        .sort((a, b) => a.period.number - b.period.number)
        .map((s) => ({ ...toCell(s), id: s.id, period: { id: s.period.id, number: s.period.number, start: s.period.startTime, end: s.period.endTime } }));
}

/** Sets or clears one cell. A teacher clash returns 409 naming where they already are. */
export async function setSlot({ sectionId, day, periodId, subjectId, staffId = null }, ctx) {
    const session = await getCurrentSession();
    const [sec, days, period] = await Promise.all([findSection(sectionId), schoolDays(), prisma.period.findUnique({ where: { id: periodId } })]);
    if (!sec || !period) throw notFound();
    if (!days.includes(day)) throw badRequest(`${DAY_NAME[day]} is a weekly holiday.`);
    const where = { sessionId_sectionId_day_periodId: { sessionId: session.id, sectionId, day, periodId } };

    if (!subjectId) {
        await prisma.routineSlot.deleteMany({ where: { sessionId: session.id, sectionId, day, periodId } });
        return getRoutine({ sectionId });
    }
    const subject = await subjectOfClass(subjectId, sec.class.id);
    if (!subject) throw badRequest("This subject is not taught in this class.");
    const teacher = staffId ? await activeStaff(staffId) : null;
    if (teacher) {
        const clash = await prisma.routineSlot.findFirst({ where: { sessionId: session.id, staffId: teacher.id, day, periodId, NOT: { sectionId } }, include: { section: { include: { class: { select: { name: true } } } } } });
        if (clash) throw conflict(`${teacher.name} already teaches ${sectionLabel(clash.section)} in period ${period.number} on ${DAY_NAME[day]}.`);
    }
    await tx(async (t) => {
        await t.routineSlot.upsert({ where, create: { sessionId: session.id, sectionId, day, periodId, subjectId, staffId: teacher?.id ?? null }, update: { subjectId, staffId: teacher?.id ?? null } });
        await audit(ctx, { action: "routine.update", entity: "Section", entityId: sectionId, after: { detail: `${sectionLabel(sec)} ${DAY_NAME[day]} P${period.number}: ${subject.name}${teacher ? ` (${teacher.name})` : ""}` } }, t);
    });
    return getRoutine({ sectionId });
}

/** Editor data for one section: subjects, the section's subject teachers, all active staff. */
export async function editorOptions(sectionId) {
    const [opts, staff] = await Promise.all([routineOptions(sectionId), staffOptions()]);
    if (!opts) throw notFound();
    return { ...opts, staff };
}
