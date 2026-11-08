import { audit } from "#core/audit.js";
import { badRequest, conflict, notFound } from "#core/errors.js";
import { prisma, tx } from "#core/prisma.js";
import { revalidateWeb } from "#core/revalidate.js";
import { slugify, uniqueSlug } from "#core/slug.js";

/**
 * Academic structure (PRD §6.1): sessions, classes, sections, subjects, class teachers and subject
 * teachers per session. Other modules get the current session through getCurrentSession().
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */

const ymd = (d) => (d ? d.toISOString().slice(0, 10) : null);
const dbDate = (s) => new Date(`${s}T00:00:00Z`);

/** @returns {Promise<{ id: string, name: string, startDate: Date, endDate: Date }>} 409 when no session is current */
export async function getCurrentSession(db = prisma) {
    const s = await db.academicSession.findUnique({ where: { isCurrent: true }, select: { id: true, name: true, startDate: true, endDate: true } });
    if (!s) throw conflict("No academic session is marked as current. Set one in Classes & subjects.");
    return s;
}

/** "Class III (A)" (same as the demo labels) */
export const sectionLabel = (s) => `${s.class.name} (${s.name})`;

/* ------------------------------ reads ------------------------------ */

export async function listSessions() {
    const rows = await prisma.academicSession.findMany({ orderBy: { startDate: "desc" } });
    return rows.map((s) => ({ id: s.id, name: s.name, startDate: ymd(s.startDate), endDate: ymd(s.endDate), isCurrent: s.isCurrent === true }));
}

/** ClassRow[] (lib/dashboard/academics listClasses) for the current session. */
export async function listClasses() {
    const session = await getCurrentSession();
    const classes = await prisma.class.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
        include: {
            subjects: { where: { isActive: true }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { name: true } },
            sections: {
                orderBy: { name: "asc" },
                include: {
                    classTeachers: { where: { sessionId: session.id }, select: { staff: { select: { id: true, name: true } } } },
                    _count: { select: { enrollments: { where: { sessionId: session.id } } } },
                },
            },
        },
    });
    return classes.map((c) => ({
        id: c.id,
        name: c.name,
        order: c.order,
        gradingMode: c.gradingMode,
        sections: c.sections.map((s) => ({ id: s.id, name: s.name, classTeacher: s.classTeachers[0]?.staff.name ?? null, classTeacherId: s.classTeachers[0]?.staff.id ?? null, students: s._count.enrollments })),
        subjects: c.subjects.map((s) => s.name),
    }));
}

/** Everything the class manager page needs. */
export async function getClass(id) {
    const session = await getCurrentSession();
    const c = await prisma.class.findUnique({
        where: { id },
        include: {
            subjects: { orderBy: [{ order: "asc" }, { name: "asc" }] },
            sections: {
                orderBy: { name: "asc" },
                include: {
                    classTeachers: { where: { sessionId: session.id }, select: { staffId: true } },
                    assignments: { where: { sessionId: session.id }, select: { subjectId: true, staffId: true } },
                    _count: { select: { enrollments: true } },
                },
            },
        },
    });
    if (!c) throw notFound();
    const subjectUse = await prisma.subject.findMany({
        where: { classId: id },
        select: { id: true, _count: { select: { examSubjects: true, assignments: true, routineSlots: true } } },
    });
    const used = new Map(subjectUse.map((s) => [s.id, s._count.examSubjects + s._count.assignments + s._count.routineSlots > 0]));
    return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        order: c.order,
        stage: c.stage.toLowerCase(),
        gradingMode: c.gradingMode,
        ageHint: c.ageHint,
        summary: c.summary,
        focus: c.focus,
        tone: c.tone.toLowerCase(),
        isActive: c.isActive,
        session: { id: session.id, name: session.name },
        sections: c.sections.map((s) => ({
            id: s.id,
            name: s.name,
            classTeacherId: s.classTeachers[0]?.staffId ?? null,
            hasStudents: s._count.enrollments > 0,
            assignments: s.assignments,
        })),
        subjects: c.subjects.map((s) => ({ id: s.id, name: s.name, code: s.code, order: s.order, isActive: s.isActive, inUse: used.get(s.id) ?? false })),
    };
}

export async function listSectionOptions() {
    const rows = await prisma.section.findMany({ where: { class: { isActive: true } }, include: { class: { select: { name: true, order: true } } } });
    return rows.sort((a, b) => a.class.order - b.class.order || a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: sectionLabel(s), classId: s.classId }));
}

export async function getGradeScale() {
    const rows = await prisma.gradeScale.findMany({ orderBy: { minPercent: "desc" } });
    return rows.map((g) => ({ minPercent: g.minPercent, maxPercent: g.maxPercent, grade: g.grade, point: Number(g.point) }));
}

/** Sections + subjects a teacher teaches in the current session ("own" scope source). */
export async function teacherAssignments(staffId) {
    const session = await getCurrentSession();
    const rows = await prisma.teacherAssignment.findMany({
        where: { staffId, sessionId: session.id },
        include: { section: { include: { class: { select: { name: true, order: true } } } }, subject: { select: { name: true, order: true } } },
    });
    return rows
        .sort((a, b) => a.section.class.order - b.section.class.order || a.section.name.localeCompare(b.section.name) || a.subject.order - b.subject.order)
        .map((a) => ({ sectionId: a.sectionId, subjectId: a.subjectId, label: `${sectionLabel(a.section)} · ${a.subject.name}` }));
}

/** Sections where the teacher is class teacher or teaches a subject. */
export async function teacherSections(staffId) {
    const session = await getCurrentSession();
    const [ct, ta] = await Promise.all([
        prisma.classTeacher.findMany({ where: { staffId, sessionId: session.id }, select: { sectionId: true } }),
        prisma.teacherAssignment.findMany({ where: { staffId, sessionId: session.id }, select: { sectionId: true }, distinct: ["sectionId"] }),
    ]);
    const classTeacherOf = new Set(ct.map((r) => r.sectionId));
    const ids = [...new Set([...classTeacherOf, ...ta.map((r) => r.sectionId)])];
    const sections = await prisma.section.findMany({ where: { id: { in: ids } }, include: { class: { select: { name: true, order: true } } } });
    return sections
        .sort((a, b) => a.class.order - b.class.order || a.name.localeCompare(b.name))
        .map((s) => ({ value: s.id, label: sectionLabel(s), isClassTeacher: classTeacherOf.has(s.id) }));
}

/* ------------------------------ sessions ------------------------------ */

/** New session; optionally copies class teachers and subject teachers from the current one. */
export async function createSession(input, ctx) {
    if (await prisma.academicSession.findUnique({ where: { name: input.name }, select: { id: true } })) throw conflict("A session with this name already exists.", { fields: ["name"] });
    const id = await tx(async (t) => {
        const current = await t.academicSession.findUnique({ where: { isCurrent: true }, select: { id: true } });
        const s = await t.academicSession.create({ data: { name: input.name, startDate: dbDate(input.startDate), endDate: dbDate(input.endDate), isCurrent: current ? null : true } });
        let copied = 0;
        if (input.copyTeachers && current) {
            const [cts, tas] = await Promise.all([
                t.classTeacher.findMany({ where: { sessionId: current.id }, select: { sectionId: true, staffId: true } }),
                t.teacherAssignment.findMany({ where: { sessionId: current.id }, select: { sectionId: true, subjectId: true, staffId: true } }),
            ]);
            if (cts.length) await t.classTeacher.createMany({ data: cts.map((r) => ({ ...r, sessionId: s.id })) });
            if (tas.length) await t.teacherAssignment.createMany({ data: tas.map((r) => ({ ...r, sessionId: s.id })) });
            copied = cts.length + tas.length;
        }
        await audit(ctx, { action: "academics.session.create", entity: "AcademicSession", entityId: s.id, after: { detail: `Created session ${input.name}${copied ? ` (copied ${copied} teacher assignments)` : ""}` } }, t);
        return s.id;
    });
    return (await listSessions()).find((s) => s.id === id);
}

/** Exactly one current session (isCurrent true|NULL + unique index). */
export async function setCurrentSession(id, ctx) {
    const s = await prisma.academicSession.findUnique({ where: { id }, select: { name: true, isCurrent: true } });
    if (!s) throw notFound();
    if (s.isCurrent) return listSessions();
    await tx(async (t) => {
        await t.academicSession.updateMany({ where: { isCurrent: true }, data: { isCurrent: null } });
        await t.academicSession.update({ where: { id }, data: { isCurrent: true } });
        await audit(ctx, { action: "academics.session.current", entity: "AcademicSession", entityId: id, after: { detail: `Made session ${s.name} current` } }, t);
    });
    return listSessions();
}

/* ------------------------------ classes ------------------------------ */

export async function createClass(input, ctx) {
    if (await prisma.class.findUnique({ where: { name: input.name }, select: { id: true } })) throw conflict("A class with this name already exists.", { fields: ["name"] });
    const slug = await uniqueSlug(slugify(input.name, "class"), async (s) => Boolean(await prisma.class.findUnique({ where: { slug: s }, select: { id: true } })));
    const id = await tx(async (t) => {
        const last = await t.class.aggregate({ _max: { order: true } });
        const c = await t.class.create({
            data: { slug, name: input.name, order: (last._max.order ?? 0) + 1, stage: input.stage.toUpperCase(), gradingMode: input.gradingMode, sections: { create: [...new Set(input.sections)].map((name) => ({ name })) } },
        });
        await audit(ctx, { action: "academics.class.create", entity: "Class", entityId: c.id, after: { detail: `Added class ${input.name}` } }, t);
        return c.id;
    });
    await revalidateWeb(["classes"]);
    return getClass(id);
}

export async function updateClass(id, patch, ctx) {
    const c = await prisma.class.findUnique({ where: { id }, select: { name: true, gradingMode: true } });
    if (!c) throw notFound();
    if (patch.gradingMode && patch.gradingMode !== c.gradingMode) {
        const exams = await prisma.examSubject.count({ where: { subject: { classId: id }, marks: { some: {} } } });
        if (exams) throw conflict("Marks already exist for this class, so its grading mode cannot change this year.");
    }
    await tx(async (t) => {
        await t.class.update({
            where: { id },
            data: {
                ...(patch.name !== undefined && { name: patch.name }),
                ...(patch.gradingMode !== undefined && { gradingMode: patch.gradingMode }),
                ...(patch.ageHint !== undefined && { ageHint: patch.ageHint }),
                ...(patch.summary !== undefined && { summary: patch.summary }),
                ...(patch.focus !== undefined && { focus: patch.focus }),
                ...(patch.tone !== undefined && { tone: patch.tone.toUpperCase() }),
                ...(patch.isActive !== undefined && { isActive: patch.isActive }),
            },
        });
        await audit(ctx, { action: "academics.class.update", entity: "Class", entityId: id, after: { detail: `Edited class ${patch.name ?? c.name}` } }, t);
    });
    await revalidateWeb(["classes"]);
    return getClass(id);
}

/* ------------------------------ sections ------------------------------ */

export async function addSection(classId, { name }, ctx) {
    const c = await prisma.class.findUnique({ where: { id: classId }, select: { name: true } });
    if (!c) throw notFound();
    await tx(async (t) => {
        const s = await t.section.create({ data: { classId, name } });
        await audit(ctx, { action: "academics.section.create", entity: "Section", entityId: s.id, after: { detail: `Added section ${c.name} · ${name}` } }, t);
    });
    return getClass(classId);
}

export async function renameSection(id, { name }, ctx) {
    const s = await prisma.section.findUnique({ where: { id }, include: { class: { select: { name: true } } } });
    if (!s) throw notFound();
    await tx(async (t) => {
        await t.section.update({ where: { id }, data: { name } });
        await audit(ctx, { action: "academics.section.update", entity: "Section", entityId: id, after: { detail: `Renamed ${sectionLabel(s)} to ${name}` } }, t);
    });
    return getClass(s.classId);
}

/** Only sections that never had students, routine or teachers. */
export async function deleteSection(id, ctx) {
    const s = await prisma.section.findUnique({ where: { id }, include: { class: { select: { name: true } }, _count: { select: { enrollments: true, routineSlots: true } } } });
    if (!s) throw notFound();
    if (s._count.enrollments || s._count.routineSlots) throw conflict("This section has students or a routine, so it cannot be deleted.");
    const left = await prisma.section.count({ where: { classId: s.classId } });
    if (left <= 1) throw conflict("A class needs at least one section.");
    await tx(async (t) => {
        await t.classTeacher.deleteMany({ where: { sectionId: id } });
        await t.teacherAssignment.deleteMany({ where: { sectionId: id } });
        await t.section.delete({ where: { id } });
        await audit(ctx, { action: "academics.section.delete", entity: "Section", entityId: id, after: { detail: `Deleted section ${sectionLabel(s)}` } }, t);
    });
    return getClass(s.classId);
}

export async function activeStaff(staffId, db = prisma) {
    const st = await db.staff.findUnique({ where: { id: staffId }, select: { id: true, name: true, isActive: true } });
    if (!st || !st.isActive) throw badRequest("Please check the highlighted fields.", [{ path: "staffId", message: "Choose an active staff member.", in: "body" }]);
    return st;
}

/** Class teacher of a section for the current session (null removes). */
export async function setClassTeacher(sectionId, { staffId }, ctx) {
    const s = await prisma.section.findUnique({ where: { id: sectionId }, include: { class: { select: { name: true } } } });
    if (!s) throw notFound();
    const session = await getCurrentSession();
    const st = staffId ? await activeStaff(staffId) : null;
    await tx(async (t) => {
        if (!st) await t.classTeacher.deleteMany({ where: { sessionId: session.id, sectionId } });
        else await t.classTeacher.upsert({ where: { sessionId_sectionId: { sessionId: session.id, sectionId } }, create: { sessionId: session.id, sectionId, staffId: st.id }, update: { staffId: st.id } });
        await audit(ctx, { action: "academics.class_teacher", entity: "Section", entityId: sectionId, after: { detail: st ? `${st.name} is class teacher of ${sectionLabel(s)} (${session.name})` : `Removed class teacher of ${sectionLabel(s)}` } }, t);
    });
    return getClass(s.classId);
}

/**
 * Subject teachers of one section for the current session. items lists subjects of the section's
 * class; staffId null removes that assignment. Subjects not listed are left unchanged.
 */
export async function setAssignments(sectionId, { items }, ctx) {
    const s = await prisma.section.findUnique({ where: { id: sectionId }, include: { class: { select: { name: true } } } });
    if (!s) throw notFound();
    const session = await getCurrentSession();
    const subjects = new Set((await prisma.subject.findMany({ where: { classId: s.classId }, select: { id: true } })).map((x) => x.id));
    if (items.some((i) => !subjects.has(i.subjectId))) throw badRequest("A subject does not belong to this class.");
    const staffIds = [...new Set(items.map((i) => i.staffId).filter(Boolean))];
    const active = new Set((await prisma.staff.findMany({ where: { id: { in: staffIds }, isActive: true }, select: { id: true } })).map((x) => x.id));
    if (staffIds.some((x) => !active.has(x))) throw badRequest("Choose active staff members only.");

    await tx(async (t) => {
        for (const i of items) {
            const key = { sectionId_subjectId_sessionId: { sectionId, subjectId: i.subjectId, sessionId: session.id } };
            if (i.staffId) await t.teacherAssignment.upsert({ where: key, create: { sectionId, subjectId: i.subjectId, sessionId: session.id, staffId: i.staffId }, update: { staffId: i.staffId } });
            else await t.teacherAssignment.deleteMany({ where: { sectionId, subjectId: i.subjectId, sessionId: session.id } });
        }
        await audit(ctx, { action: "academics.assignments", entity: "Section", entityId: sectionId, after: { detail: `Updated subject teachers of ${sectionLabel(s)} (${session.name})` } }, t);
    });
    return getClass(s.classId);
}

/* ------------------------------ subjects ------------------------------ */

export async function addSubject(classId, input, ctx) {
    const c = await prisma.class.findUnique({ where: { id: classId }, select: { name: true } });
    if (!c) throw notFound();
    await tx(async (t) => {
        const last = await t.subject.aggregate({ where: { classId }, _max: { order: true } });
        const s = await t.subject.create({ data: { classId, name: input.name, code: input.code || null, order: (last._max.order ?? 0) + 1 } });
        await audit(ctx, { action: "academics.subject.create", entity: "Subject", entityId: s.id, after: { detail: `Added ${input.name} to ${c.name}` } }, t);
    });
    return getClass(classId);
}

export async function updateSubject(id, patch, ctx) {
    const s = await prisma.subject.findUnique({ where: { id }, include: { class: { select: { name: true } } } });
    if (!s) throw notFound();
    await tx(async (t) => {
        await t.subject.update({
            where: { id },
            data: { ...(patch.name !== undefined && { name: patch.name }), ...(patch.code !== undefined && { code: patch.code || null }), ...(patch.isActive !== undefined && { isActive: patch.isActive }) },
        });
        await audit(ctx, { action: "academics.subject.update", entity: "Subject", entityId: id, after: { detail: `Edited ${s.class.name} ${patch.name ?? s.name}${patch.isActive === false ? " (turned off)" : ""}` } }, t);
    });
    return getClass(s.classId);
}

/** Only subjects never used in exams, routine or assignments; otherwise turn them off. */
export async function deleteSubject(id, ctx) {
    const s = await prisma.subject.findUnique({ where: { id }, include: { class: { select: { name: true } }, _count: { select: { examSubjects: true, assignments: true, routineSlots: true } } } });
    if (!s) throw notFound();
    if (s._count.examSubjects || s._count.assignments || s._count.routineSlots) throw conflict("This subject is used in exams, routine or teacher assignments. Turn it off instead.");
    await tx(async (t) => {
        await t.subject.delete({ where: { id } });
        await audit(ctx, { action: "academics.subject.delete", entity: "Subject", entityId: id, after: { detail: `Deleted ${s.class.name} ${s.name}` } }, t);
    });
    return getClass(s.classId);
}

export async function reorderSubjects(classId, ids) {
    const mine = new Set((await prisma.subject.findMany({ where: { classId }, select: { id: true } })).map((s) => s.id));
    await tx(async (t) => {
        for (const [i, id] of ids.filter((x) => mine.has(x)).entries()) await t.subject.update({ where: { id }, data: { order: i + 1 } });
    });
    return getClass(classId);
}

/** For the staff module: removes a deactivated person's current-session class/subject assignments. Returns how many. */
export async function clearStaffAssignments(staffId, t) {
    const session = await t.academicSession.findUnique({ where: { isCurrent: true }, select: { id: true } });
    if (!session) return 0;
    const a = await t.teacherAssignment.deleteMany({ where: { staffId, sessionId: session.id } });
    const c = await t.classTeacher.deleteMany({ where: { staffId, sessionId: session.id } });
    return a.count + c.count;
}

/** Teacher "own" scope as a set of section ids (current session). */
export async function teacherSectionIds(staffId) {
    if (!staffId) return new Set();
    return new Set((await teacherSections(staffId)).map((s) => s.value));
}

/**
 * Section ids the user may see for student data, or null for "all".
 * Teachers (role TEACHER, same rule as the frontend) are limited to their own sections.
 * @param {import("#core/auth.js").AuthUser} user
 */
export async function sectionScope(user) {
    if (user.role !== "TEACHER") return null;
    return teacherSectionIds(user.staffId);
}

/** Section with its class, or null. */
export const findSection = (id) => prisma.section.findUnique({ where: { id }, include: { class: { select: { id: true, name: true, order: true } } } });

/** Periods ordered by number (routine). */
export const listPeriods = () => prisma.period.findMany({ orderBy: { number: "asc" } });

/** Subject of the given class (active), or null. */
export const subjectOfClass = (subjectId, classId) => prisma.subject.findFirst({ where: { id: subjectId, classId, isActive: true }, select: { id: true, name: true } });

/** Routine editor helpers: active subjects of a class and the section's subject teachers (current session). */
export async function routineOptions(sectionId) {
    const sec = await findSection(sectionId);
    if (!sec) return null;
    const session = await getCurrentSession();
    const [subjects, assignments] = await Promise.all([
        prisma.subject.findMany({ where: { classId: sec.class.id, isActive: true }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
        prisma.teacherAssignment.findMany({ where: { sectionId, sessionId: session.id }, select: { subjectId: true, staffId: true } }),
    ]);
    return { subjects, assignments: Object.fromEntries(assignments.map((a) => [a.subjectId, a.staffId])) };
}
