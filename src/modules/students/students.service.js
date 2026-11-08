import { hashPassword } from "#core/auth.js";
import { audit } from "#core/audit.js";
import { badRequest, conflict, notFound } from "#core/errors.js";
import { fromDbDate, toDbDate, dhakaDateString } from "#core/dates.js";
import { tempPassword } from "#core/password.js";
import { nextCounter, prisma, tx } from "#core/prisma.js";
import { ROLE_KEYS } from "#core/rbac.js";
import { removeStored } from "#core/storage.js";

import { findSection, getCurrentSession, sectionLabel, sectionScope } from "#modules/academics/academics.service.js";
import { enrollmentAttendanceSummary } from "#modules/attendance/attendance.service.js";
import { duesForStudents } from "#modules/fees/fees.service.js";
import { studentUidPrefix } from "#modules/settings/settings.service.js";

import { importRow } from "./students.schema.js";
import { zodDetails } from "#core/errors.js";

/**
 * Students & enrollments (PRD §6.2). Student is permanent; Enrollment = one row per session with
 * section and roll. Admission also creates the guardian portal login (username = student ID).
 * Scope: teachers see only students of their own sections (404 otherwise); a student/guardian
 * user only their own record.
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */
/** @typedef {import("#core/auth.js").AuthUser} AuthUser */

const sectionInclude = { section: { include: { class: { select: { id: true, name: true, order: true } } } } };

/** @param {AuthUser} user @param {{ sectionId: string }} en */
async function assertInScope(user, studentId, sectionId) {
    if (user.role === ROLE_KEYS.STUDENT) {
        if (user.studentId !== studentId) throw notFound();
        return;
    }
    const scope = await sectionScope(user);
    if (scope && !scope.has(sectionId)) throw notFound();
}

/* ------------------------------ reads ------------------------------ */

/** StudentRow[] (lib/dashboard/students listStudents) for the current session. */
export async function listStudents({ sectionIds, sectionId, q, status = "ACTIVE" } = {}, user) {
    const session = await getCurrentSession();
    const scope = user ? await sectionScope(user) : null;
    let wanted = sectionIds ?? (sectionId ? [sectionId] : null);
    if (scope) wanted = (wanted ?? [...scope]).filter((id) => scope.has(id));
    const rows = await prisma.enrollment.findMany({
        where: {
            sessionId: session.id,
            ...(wanted && { sectionId: { in: wanted } }),
            student: {
                ...(status !== "all" && { status }),
                ...(q && { OR: [{ name: { contains: q, mode: "insensitive" } }, { studentUid: { contains: q, mode: "insensitive" } }, { guardianPhone: { contains: q.replace(/\D/g, "") || q } }] }),
            },
        },
        include: { student: true, ...sectionInclude },
    });
    const dues = await duesForStudents(rows.map((r) => r.studentId));
    return rows
        .map((e) => ({
            id: e.student.id,
            studentUid: e.student.studentUid,
            name: e.student.name,
            gender: e.student.gender,
            classId: e.section.class.id,
            className: e.section.class.name,
            classOrder: e.section.class.order,
            sectionId: e.sectionId,
            section: sectionLabel(e.section),
            roll: e.roll,
            fatherName: e.student.fatherName ?? "",
            guardianPhone: e.student.guardianPhone,
            status: e.student.status,
            bloodGroup: e.student.bloodGroup ?? "",
            hasPhoto: Boolean(e.student.photoPath),
            due: dues.get(e.studentId) ?? 0,
        }))
        .sort((a, b) => a.classOrder - b.classOrder || a.section.localeCompare(b.section) || a.roll - b.roll);
}

/** Profile (lib/dashboard/students getStudent). 404 outside the caller's scope. */
export async function getStudent(id, user) {
    const session = await getCurrentSession();
    const s = await prisma.student.findUnique({
        where: { id },
        include: { enrollments: { include: { ...sectionInclude, session: { select: { id: true, name: true, startDate: true } } } }, user: { select: { id: true, username: true, status: true, lastLoginAt: true } } },
    });
    if (!s) throw notFound();
    const en = s.enrollments.find((e) => e.sessionId === session.id) ?? null;
    if (user) await assertInScope(user, s.id, en?.sectionId ?? "-");
    const [att, dues] = await Promise.all([en ? enrollmentAttendanceSummary(en.id) : null, duesForStudents([s.id])]);
    return {
        id: s.id,
        studentUid: s.studentUid,
        name: s.name,
        dob: fromDbDate(s.dob),
        gender: s.gender,
        bloodGroup: s.bloodGroup ?? "",
        fatherName: s.fatherName ?? "",
        motherName: s.motherName ?? "",
        guardianName: s.guardianName ?? "",
        guardianPhone: s.guardianPhone,
        guardianPhone2: s.guardianPhone2 ?? "",
        guardianEmail: s.guardianEmail ?? "",
        address: s.address ?? "",
        admissionDate: fromDbDate(s.admissionDate) ?? "",
        status: s.status,
        hasPhoto: Boolean(s.photoPath),
        classId: en?.section.class.id ?? null,
        className: en?.section.class.name ?? null,
        sectionId: en?.sectionId ?? null,
        section: en ? sectionLabel(en.section) : null,
        roll: en?.roll ?? null,
        enrollmentId: en?.id ?? null,
        attendance: att ?? { present: 0, absent: 0, late: 0, rate: 0 },
        due: dues.get(s.id) ?? 0,
        portal: s.user ? { username: s.user.username, status: s.user.status, lastLogin: s.user.lastLoginAt?.toISOString() ?? null } : null,
        history: s.enrollments
            .sort((a, b) => b.session.startDate - a.session.startDate)
            .map((e) => ({ session: e.session.name, section: sectionLabel(e.section), roll: e.roll })),
    };
}

export async function studentCounts() {
    const session = await getCurrentSession();
    const year = String(session.startDate.getUTCFullYear());
    const [active, byClass] = await Promise.all([
        prisma.student.findMany({ where: { status: "ACTIVE", enrollments: { some: { sessionId: session.id } } }, select: { gender: true, admissionDate: true } }),
        prisma.class.findMany({ where: { isActive: true }, orderBy: { order: "asc" }, select: { name: true, sections: { select: { _count: { select: { enrollments: { where: { sessionId: session.id, student: { status: "ACTIVE" } } } } } } } } }),
    ]);
    return {
        total: active.length,
        boys: active.filter((s) => s.gender === "MALE").length,
        girls: active.filter((s) => s.gender === "FEMALE").length,
        newThisYear: active.filter((s) => fromDbDate(s.admissionDate)?.startsWith(year)).length,
        byClass: byClass.map((c) => ({ label: c.name, value: c.sections.reduce((n, sec) => n + sec._count.enrollments, 0) })),
    };
}

/* ------------------------------ helpers for other modules ------------------------------ */

/** Active students of a section in the current session (or sessionId), by roll (attendance taker, SMS, marks). */
export async function sectionRoster(sectionId, sessionId) {
    const sid = sessionId ?? (await getCurrentSession()).id;
    const rows = await prisma.enrollment.findMany({ where: { sectionId, sessionId: sid, student: { status: "ACTIVE" } }, orderBy: { roll: "asc" }, include: { student: { select: { id: true, studentUid: true, name: true, gender: true, guardianPhone: true } } } });
    return rows.map((e) => ({ enrollmentId: e.id, studentId: e.student.id, studentUid: e.student.studentUid, name: e.student.name, roll: e.roll, gender: e.student.gender, guardianPhone: e.student.guardianPhone }));
}

/** Current enrollment of a student with section/class (portal, routine, notices). */
export async function currentEnrollment(studentId) {
    const session = await getCurrentSession();
    return prisma.enrollment.findUnique({ where: { studentId_sessionId: { studentId, sessionId: session.id } }, include: sectionInclude });
}

/** Guardian numbers for SMS. filter: { all } | { sectionId } | { studentIds } (active, current session). */
export async function guardianRecipients(filter) {
    const session = await getCurrentSession();
    const rows = await prisma.enrollment.findMany({
        where: { sessionId: session.id, student: { status: "ACTIVE", ...(filter.studentIds && { id: { in: filter.studentIds } }) }, ...(filter.sectionId && { sectionId: filter.sectionId }) },
        include: { student: { select: { id: true, name: true, guardianPhone: true } }, ...sectionInclude },
    });
    return rows.map((e) => ({ studentId: e.student.id, name: e.student.name, phone: e.student.guardianPhone, roll: e.roll, className: sectionLabel(e.section) }));
}

/** Counts per section for SMS audiences (active, current session). */
export async function sectionCounts() {
    const session = await getCurrentSession();
    const rows = await prisma.enrollment.groupBy({ by: ["sectionId"], where: { sessionId: session.id, student: { status: "ACTIVE" } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.sectionId, r._count._all]));
}

/* ------------------------------ admission ------------------------------ */

/** Next "LFIS-26xxx": counter row per year, started from the highest existing number the first time. */
async function nextStudentUid(t, year) {
    const prefix = await studentUidPrefix();
    const yy = String(year).slice(-2);
    const key = `studentUid:${prefix}${yy}`;
    if (!(await t.counter.findUnique({ where: { key } }))) {
        const existing = await t.student.findMany({ where: { studentUid: { startsWith: `${prefix}${yy}` } }, select: { studentUid: true } });
        const max = existing.reduce((m, s) => Math.max(m, Number(s.studentUid.slice(prefix.length + 2)) || 0), 0);
        await t.counter.upsert({ where: { key }, create: { key, value: max }, update: {} });
    }
    const n = await nextCounter(t, key);
    return `${prefix}${yy}${String(n).padStart(3, "0")}`;
}

/** Serialises roll assignment per section (unique sessionId+sectionId+roll). */
async function nextRoll(t, sessionId, sectionId) {
    await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`roll:${sessionId}:${sectionId}`}))`;
    const last = await t.enrollment.aggregate({ where: { sessionId, sectionId }, _max: { roll: true } });
    return (last._max.roll ?? 0) + 1;
}

const profileData = (i) => ({
    ...(i.name !== undefined && { name: i.name }),
    ...(i.dob !== undefined && { dob: toDbDate(i.dob) }),
    ...(i.gender !== undefined && { gender: i.gender }),
    ...(i.bloodGroup !== undefined && { bloodGroup: i.bloodGroup }),
    ...(i.fatherName !== undefined && { fatherName: i.fatherName }),
    ...(i.motherName !== undefined && { motherName: i.motherName }),
    ...(i.guardianName !== undefined && { guardianName: i.guardianName }),
    ...(i.guardianPhone !== undefined && { guardianPhone: i.guardianPhone }),
    ...(i.guardianPhone2 !== undefined && { guardianPhone2: i.guardianPhone2 }),
    ...(i.guardianEmail !== undefined && { guardianEmail: i.guardianEmail }),
    ...(i.address !== undefined && { address: i.address }),
    ...(i.admissionDate !== undefined && { admissionDate: i.admissionDate ? toDbDate(i.admissionDate) : null }),
});

/** @returns {Promise<{ student: object, portal: { username: string, tempPassword: string } }>} */
export async function createStudent(input, ctx) {
    const session = await getCurrentSession();
    const section = await findSection(input.sectionId);
    if (!section) throw badRequest("Please check the highlighted fields.", [{ path: "sectionId", message: "Choose a class.", in: "body" }]);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.STUDENT }, select: { id: true } });
    const password = tempPassword();
    const passwordHash = await hashPassword(password);

    const { id, studentUid } = await tx(async (t) => {
        const uid = await nextStudentUid(t, session.startDate.getUTCFullYear());
        const roll = input.roll ?? (await nextRoll(t, session.id, section.id));
        if (input.roll && (await t.enrollment.findFirst({ where: { sessionId: session.id, sectionId: section.id, roll: input.roll }, select: { id: true } }))) {
            throw conflict(`Roll ${input.roll} is already used in ${sectionLabel(section)}.`, { fields: ["roll"] });
        }
        const user = await t.user.create({ data: { name: input.name, username: uid.toLowerCase(), passwordHash, roleId: role.id, mustChangePassword: true }, select: { id: true } });
        const s = await t.student.create({
            data: { ...profileData(input), studentUid: uid, admissionDate: toDbDate(input.admissionDate ?? dhakaDateString()), userId: user.id },
            select: { id: true },
        });
        await t.enrollment.create({ data: { studentId: s.id, sessionId: session.id, sectionId: section.id, roll } });
        await audit(ctx, { action: "student.create", entity: "Student", entityId: s.id, after: { detail: `Admitted ${input.name} (${uid}) to ${sectionLabel(section)}, roll ${roll}` } }, t);
        return { id: s.id, studentUid: uid };
    }, { timeout: 20_000 });

    return { student: await getStudent(id), portal: { username: studentUid, tempPassword: password } };
}

/** Profile, status and current-session section/roll. Leaving (inactive/transferred/graduated) disables the portal login. */
export async function updateStudent(id, patch, ctx) {
    const session = await getCurrentSession();
    const s = await prisma.student.findUnique({ where: { id }, include: { enrollments: { where: { sessionId: session.id }, include: sectionInclude } } });
    if (!s) throw notFound();
    const en = s.enrollments[0];
    const moving = (patch.sectionId && patch.sectionId !== en?.sectionId) || (patch.roll && patch.roll !== en?.roll);
    if (moving && !en) throw conflict("This student is not enrolled in the current session.");
    const target = patch.sectionId ? await findSection(patch.sectionId) : en?.section;
    if (patch.sectionId && !target) throw badRequest("Choose a class.");

    await tx(async (t) => {
        await t.student.update({ where: { id }, data: { ...profileData(patch), ...(patch.status && { status: patch.status }) } });
        if (moving) {
            const roll = patch.roll ?? (patch.sectionId !== en.sectionId ? await nextRoll(t, session.id, target.id) : en.roll);
            const clash = await t.enrollment.findFirst({ where: { sessionId: session.id, sectionId: target.id, roll, id: { not: en.id } }, select: { id: true } });
            if (clash) throw conflict(`Roll ${roll} is already used in ${sectionLabel(target)}.`, { fields: ["roll"] });
            await t.enrollment.update({ where: { id: en.id }, data: { sectionId: target.id, roll } });
        }
        if (patch.status && s.userId) {
            await t.user.update({ where: { id: s.userId }, data: { status: patch.status === "ACTIVE" ? "ACTIVE" : "DISABLED" } });
            if (patch.status !== "ACTIVE") await t.refreshToken.updateMany({ where: { userId: s.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        const parts = [moving && `moved to ${sectionLabel(target)}`, patch.status && patch.status !== s.status && `status ${patch.status.toLowerCase()}`].filter(Boolean);
        await audit(ctx, { action: "student.update", entity: "Student", entityId: id, after: { detail: `Edited ${patch.name ?? s.name}${parts.length ? ` (${parts.join(", ")})` : ""}` } }, t);
    });
    return getStudent(id);
}

/** New one-time password for the guardian portal (shown once). */
export async function resetPortal(id, ctx) {
    const s = await prisma.student.findUnique({ where: { id }, select: { name: true, studentUid: true, userId: true, status: true } });
    if (!s) throw notFound();
    const password = tempPassword();
    const passwordHash = await hashPassword(password);
    await tx(async (t) => {
        let userId = s.userId;
        if (!userId) {
            const role = await t.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.STUDENT }, select: { id: true } });
            userId = (await t.user.create({ data: { name: s.name, username: s.studentUid.toLowerCase(), passwordHash, roleId: role.id, mustChangePassword: true }, select: { id: true } })).id;
            await t.student.update({ where: { id }, data: { userId } });
        } else {
            await t.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, status: s.status === "ACTIVE" ? "ACTIVE" : "DISABLED" } });
            await t.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        await audit(ctx, { action: "student.portal_reset", entity: "Student", entityId: id, after: { detail: `Reset portal password for ${s.name} (${s.studentUid})` } }, t);
    });
    return { username: s.studentUid, tempPassword: password };
}

/* ------------------------------ photo (private) ------------------------------ */

export async function setPhoto(id, photoPath, ctx) {
    const s = await prisma.student.findUnique({ where: { id }, select: { name: true, photoPath: true } });
    if (!s) throw notFound();
    await prisma.student.update({ where: { id }, data: { photoPath } });
    await audit(ctx, { action: "student.photo", entity: "Student", entityId: id, after: { detail: `Updated photo of ${s.name}` } });
    if (s.photoPath && s.photoPath !== photoPath) await removeStored(s.photoPath);
    return { hasPhoto: true };
}

/** Relative private path of the photo, after the same scope check as the profile. */
export async function photoPathFor(id, user) {
    const s = await prisma.student.findUnique({ where: { id }, select: { photoPath: true, enrollments: { select: { sectionId: true, sessionId: true } } } });
    if (!s?.photoPath) throw notFound();
    const session = await getCurrentSession();
    await assertInScope(user, id, s.enrollments.find((e) => e.sessionId === session.id)?.sectionId ?? "-");
    return s.photoPath;
}

/* ------------------------------ promotion ------------------------------ */

/**
 * Enrolls the chosen students of one section into a section of another session (usually next year).
 * Students not chosen are simply not carried over (held back students are promoted later into the
 * same class, leavers get a status). One transaction; a student already enrolled in the target
 * session is skipped and reported.
 */
export async function promote({ fromSectionId, toSessionId, toSectionId, studentIds, rollMode }, ctx) {
    const current = await getCurrentSession();
    const [target, from, to] = await Promise.all([prisma.academicSession.findUnique({ where: { id: toSessionId } }), findSection(fromSectionId), findSection(toSectionId)]);
    if (!target || !from || !to) throw notFound();
    if (target.id === current.id) throw badRequest("Choose the next session (create it first in Classes & subjects).");
    const source = await prisma.enrollment.findMany({ where: { sessionId: current.id, sectionId: fromSectionId, studentId: { in: studentIds } }, include: { student: { select: { name: true, status: true } } } });
    if (source.length !== new Set(studentIds).size) throw badRequest("Some students are not in this class this session.");

    return tx(async (t) => {
        const already = new Set((await t.enrollment.findMany({ where: { sessionId: target.id, studentId: { in: studentIds } }, select: { studentId: true } })).map((e) => e.studentId));
        const todo = source.filter((e) => !already.has(e.studentId) && e.student.status === "ACTIVE");
        const ordered = rollMode === "name" ? [...todo].sort((a, b) => a.student.name.localeCompare(b.student.name)) : [...todo].sort((a, b) => a.roll - b.roll);
        await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`roll:${target.id}:${to.id}`}))`;
        const used = new Set((await t.enrollment.findMany({ where: { sessionId: target.id, sectionId: to.id }, select: { roll: true } })).map((e) => e.roll));
        let next = 1;
        const data = ordered.map((e) => {
            let roll = rollMode === "keep" && !used.has(e.roll) ? e.roll : null;
            if (roll === null) {
                while (used.has(next)) next++;
                roll = next;
            }
            used.add(roll);
            return { studentId: e.studentId, sessionId: target.id, sectionId: to.id, roll };
        });
        if (data.length) await t.enrollment.createMany({ data });
        await audit(ctx, { action: "student.promote", entity: "Section", entityId: fromSectionId, after: { detail: `Promoted ${data.length} students from ${sectionLabel(from)} (${current.name}) to ${sectionLabel(to)} (${target.name})` } }, t);
        return { promoted: data.length, skipped: source.length - data.length };
    }, { timeout: 30_000 });
}

/* ------------------------------ CSV import (Step 5) ------------------------------ */

const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Bulk admission from a CSV (parsed in the browser). dryRun validates everything and changes nothing.
 * A commit is all-or-nothing for the batch sent (one transaction): if any row fails, nothing is saved.
 * Checks: required fields, class + section exist, roll free (in the DB and inside the file), and a
 * likely duplicate (same name + date of birth + guardian phone already admitted) is an error.
 * @returns {Promise<{ valid: number, errors: { row: number, field: string, message: string }[], created?: { row: number, name: string, studentUid: string, section: string, roll: number, username: string, tempPassword: string }[] }>}
 */
export async function importStudents({ rows, firstRow, dryRun }, ctx) {
    const session = await getCurrentSession();
    const sections = await prisma.section.findMany({ where: { class: { isActive: true } }, include: { class: { select: { id: true, name: true, order: true } } } });
    const byName = new Map(sections.map((x) => [`${norm(x.class.name)}|${norm(x.name)}`, x]));
    const errors = [];
    const parsed = [];
    rows.forEach((raw, i) => {
        const rowNo = firstRow + i;
        const r = importRow.safeParse(raw);
        if (!r.success) {
            for (const d of zodDetails(r.error)) errors.push({ row: rowNo, field: d.path, message: d.message });
            return;
        }
        const v = r.data;
        const classKeys = [norm(v.class), norm(`class ${v.class}`)];
        let section;
        if (v.section) {
            section = classKeys.map((k) => byName.get(`${k}|${norm(v.section)}`)).find(Boolean);
            if (!section) return errors.push({ row: rowNo, field: "section", message: `No class "${v.class}" with section "${v.section}".` });
        } else {
            // No section given: fine when the class has exactly one section.
            const options = sections.filter((x) => classKeys.includes(norm(x.class.name)));
            if (!options.length) return errors.push({ row: rowNo, field: "class", message: `No class "${v.class}".` });
            if (options.length > 1) return errors.push({ row: rowNo, field: "section", message: `Write the section for ${options[0].class.name}: ${options.map((x) => x.name).join(", ")}.` });
            section = options[0];
        }
        parsed.push({ rowNo, v, section });
    });

    // Roll clashes inside the file and against the current session.
    const seen = new Map();
    for (const p of parsed.filter((x) => x.v.roll)) {
        const k = `${p.section.id}|${p.v.roll}`;
        if (seen.has(k)) errors.push({ row: p.rowNo, field: "roll", message: `Roll ${p.v.roll} is also on row ${seen.get(k)}.` });
        else seen.set(k, p.rowNo);
    }
    const taken = parsed.length
        ? await prisma.enrollment.findMany({ where: { sessionId: session.id, OR: parsed.filter((p) => p.v.roll).map((p) => ({ sectionId: p.section.id, roll: p.v.roll })) }, select: { sectionId: true, roll: true } })
        : [];
    const takenSet = new Set(taken.map((t) => `${t.sectionId}|${t.roll}`));
    for (const p of parsed) if (p.v.roll && takenSet.has(`${p.section.id}|${p.v.roll}`)) errors.push({ row: p.rowNo, field: "roll", message: `Roll ${p.v.roll} is already used in ${sectionLabel(p.section)}.` });

    // Likely duplicates of students already admitted.
    if (parsed.length) {
        const existing = await prisma.student.findMany({ where: { guardianPhone: { in: [...new Set(parsed.map((p) => p.v.guardianPhone))] } }, select: { name: true, dob: true, guardianPhone: true, studentUid: true } });
        const dup = new Map(existing.map((e) => [`${norm(e.name)}|${fromDbDate(e.dob)}|${e.guardianPhone}`, e.studentUid]));
        for (const p of parsed) {
            const uid = dup.get(`${norm(p.v.name)}|${p.v.dob}|${p.v.guardianPhone}`);
            if (uid) errors.push({ row: p.rowNo, field: "name", message: `Looks like ${uid} (same name, birth date and guardian phone) is already admitted.` });
        }
    }

    errors.sort((a, b) => a.row - b.row);
    const bad = new Set(errors.map((e) => e.row));
    if (dryRun || errors.length) return { valid: parsed.filter((p) => !bad.has(p.rowNo)).length, errors };

    // Hash outside the transaction (argon2 is the slow part), then write everything at once.
    const role = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.STUDENT }, select: { id: true } });
    const creds = [];
    for (const p of parsed) {
        const pw = tempPassword();
        creds.push({ pw, hash: await hashPassword(pw) });
    }
    const created = await tx(
        async (t) => {
            const out = [];
            for (const [i, p] of parsed.entries()) {
                const uid = await nextStudentUid(t, session.startDate.getUTCFullYear());
                const roll = p.v.roll ?? (await nextRoll(t, session.id, p.section.id));
                const user = await t.user.create({ data: { name: p.v.name, username: uid.toLowerCase(), passwordHash: creds[i].hash, roleId: role.id, mustChangePassword: true }, select: { id: true } });
                const s = await t.student.create({
                    data: { ...profileData(p.v), studentUid: uid, admissionDate: toDbDate(p.v.admissionDate ?? dhakaDateString()), userId: user.id },
                    select: { id: true },
                });
                await t.enrollment.create({ data: { studentId: s.id, sessionId: session.id, sectionId: p.section.id, roll } });
                out.push({ row: p.rowNo, name: p.v.name, studentUid: uid, section: sectionLabel(p.section), roll, username: uid.toLowerCase(), tempPassword: creds[i].pw });
            }
            await audit(ctx, { action: "student.import", entity: "Student", entityId: null, after: { detail: `Imported ${out.length} students (rows ${firstRow}–${firstRow + rows.length - 1})` } }, t);
            return out;
        },
        { timeout: 120_000 },
    );
    return { valid: created.length, errors: [], created };
}
