import { Prisma } from "@prisma/client";

import { audit } from "#core/audit.js";
import { badRequest, conflict, forbidden, notFound } from "#core/errors.js";
import { fromDbDate, toDbDate } from "#core/dates.js";
import { logger } from "#core/logger.js";
import { prisma, tx } from "#core/prisma.js";
import { enqueue, QUEUES } from "#core/queue.js";
import { can, ROLE_KEYS } from "#core/rbac.js";

import { findSection, getCurrentSession, getGradeScale, sectionLabel, teacherAssignments } from "#modules/academics/academics.service.js";
import { duesForStudents } from "#modules/fees/fees.service.js";
import { admitDueLimit, tieBreak } from "#modules/settings/settings.service.js";
import { getStudent, sectionRoster } from "#modules/students/students.service.js";

import { computeResult, isEntered, prepareScale, withPositions } from "./exams.grading.js";

/**
 * Exams & results (PRD §6.3). DRAFT → MARKS_OPEN → LOCKED → PUBLISHED.
 * - Marks are editable only while MARKS_OPEN; teachers only for their assigned section + subject.
 * - Publishing freezes one ResultSnapshot per student (same calculation as the live tabulation);
 *   the portal reads only snapshots, so guardians never see drafts or later edits.
 * - Unpublish (Super Admin only) deletes the snapshots and returns the exam to LOCKED.
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */
/** @typedef {import("#core/auth.js").AuthUser} AuthUser */

const num = (d) => (d == null ? null : Number(d));
const STATUS_FLOW = { DRAFT: ["MARKS_OPEN"], MARKS_OPEN: ["LOCKED", "DRAFT"], LOCKED: ["MARKS_OPEN"], PUBLISHED: [] };

async function findExam(id, db = prisma) {
    const exam = await db.exam.findUnique({ where: { id } });
    if (!exam) throw notFound();
    return exam;
}

const examOut = (e) => ({
    id: e.id,
    name: e.name,
    shortName: e.shortName,
    status: e.status,
    startDate: fromDbDate(e.startDate),
    endDate: fromDbDate(e.endDate),
    publishedAt: e.publishedAt?.toISOString() ?? null,
});

/* ------------------------------ list / detail ------------------------------ */

/** Exams of the current session with marks-entry progress (active students only). */
export async function listExams() {
    const session = await getCurrentSession();
    const exams = await prisma.exam.findMany({ where: { sessionId: session.id }, orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], include: { _count: { select: { subjects: true } } } });
    if (!exams.length) return [];
    const [expected, entered] = await Promise.all([
        prisma.$queryRaw`
            SELECT es."examId" AS id, SUM(cnt.n)::int AS n
            FROM "ExamSubject" es
            JOIN "Exam" x ON x.id = es."examId" AND x."sessionId" = ${session.id}::uuid
            JOIN "Subject" sub ON sub.id = es."subjectId"
            JOIN (
                SELECT sec."classId", COUNT(*)::int AS n
                FROM "Enrollment" e
                JOIN "Section" sec ON sec.id = e."sectionId"
                JOIN "Student" s ON s.id = e."studentId" AND s.status = 'ACTIVE'
                WHERE e."sessionId" = ${session.id}::uuid
                GROUP BY sec."classId"
            ) cnt ON cnt."classId" = sub."classId"
            GROUP BY es."examId"`,
        prisma.$queryRaw`
            SELECT es."examId" AS id, COUNT(*)::int AS n
            FROM "Mark" m
            JOIN "ExamSubject" es ON es.id = m."examSubjectId"
            JOIN "Exam" x ON x.id = es."examId" AND x."sessionId" = ${session.id}::uuid
            JOIN "Enrollment" e ON e.id = m."enrollmentId"
            JOIN "Student" s ON s.id = e."studentId" AND s.status = 'ACTIVE'
            WHERE m.obtained IS NOT NULL OR m.absent OR m.remarks IS NOT NULL
            GROUP BY es."examId"`,
    ]);
    const exp = new Map(expected.map((r) => [r.id, Number(r.n)]));
    const ent = new Map(entered.map((r) => [r.id, Number(r.n)]));
    return exams.map((e) => {
        const total = exp.get(e.id) ?? 0;
        return { ...examOut(e), subjects: e._count.subjects, progress: total ? Math.min(100, Math.round(((ent.get(e.id) ?? 0) / total) * 100)) : 0 };
    });
}

/** Not yet published exams of the current session (dashboards, portal admit card). */
export async function upcomingExams() {
    const session = await getCurrentSession();
    const rows = await prisma.exam.findMany({ where: { sessionId: session.id, status: { not: "PUBLISHED" } }, orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] });
    return rows.map((e) => ({ id: e.id, name: e.name, startDate: fromDbDate(e.startDate), endDate: fromDbDate(e.endDate), status: e.status }));
}

/** Setup view: subjects grouped by class with full/pass marks and schedule. */
export async function getExam(id) {
    const exam = await findExam(id);
    const subjects = await prisma.examSubject.findMany({
        where: { examId: id },
        include: { subject: { include: { class: { select: { id: true, name: true, order: true, gradingMode: true } } } }, _count: { select: { marks: true } } },
    });
    const classes = new Map();
    for (const es of subjects.sort((a, b) => a.subject.class.order - b.subject.class.order || a.subject.order - b.subject.order)) {
        const c = es.subject.class;
        if (!classes.has(c.id)) classes.set(c.id, { classId: c.id, name: c.name, gradingMode: c.gradingMode, subjects: [] });
        classes.get(c.id).subjects.push({
            examSubjectId: es.id,
            subjectId: es.subjectId,
            name: es.subject.name,
            fullMarks: es.fullMarks,
            passMarks: es.passMarks,
            examDate: fromDbDate(es.examDate),
            startTime: es.startTime,
            hasMarks: es._count.marks > 0,
        });
    }
    return { ...examOut(exam), classes: [...classes.values()] };
}

/* ------------------------------ setup ------------------------------ */

export async function createExam(input, ctx) {
    const session = await getCurrentSession();
    if (await prisma.exam.findUnique({ where: { sessionId_name: { sessionId: session.id, name: input.name } }, select: { id: true } })) throw conflict("An exam with this name already exists in this session.", [{ path: "name", message: "Already used in this session." }]);
    const subjects = await prisma.subject.findMany({
        where: { isActive: true, class: { isActive: true, ...(input.classIds && { id: { in: input.classIds } }) } },
        select: { id: true },
    });
    if (!subjects.length) throw badRequest("The chosen classes have no active subjects.");
    const exam = await tx(async (t) => {
        const e = await t.exam.create({
            data: { sessionId: session.id, name: input.name, shortName: input.shortName ?? null, startDate: input.startDate ? toDbDate(input.startDate) : null, endDate: input.endDate ? toDbDate(input.endDate) : null },
        });
        await t.examSubject.createMany({ data: subjects.map((s) => ({ examId: e.id, subjectId: s.id, fullMarks: input.fullMarks, passMarks: input.passMarks })) });
        await audit(ctx, { action: "exam.create", entity: "Exam", entityId: e.id, after: { detail: `Created exam "${e.name}" with ${subjects.length} subjects` } }, t);
        return e;
    });
    return getExam(exam.id);
}

export async function updateExam(id, patch, ctx) {
    const exam = await findExam(id);
    if (exam.status === "PUBLISHED") throw conflict("A published exam cannot be edited. Unpublish it first.");
    if (patch.name && patch.name !== exam.name && (await prisma.exam.findUnique({ where: { sessionId_name: { sessionId: exam.sessionId, name: patch.name } }, select: { id: true } })))
        throw conflict("An exam with this name already exists in this session.", [{ path: "name", message: "Already used in this session." }]);
    const start = patch.startDate !== undefined ? patch.startDate : fromDbDate(exam.startDate);
    const end = patch.endDate !== undefined ? patch.endDate : fromDbDate(exam.endDate);
    if (start && end && end < start) throw badRequest("Invalid request", [{ path: "endDate", message: "The end date must be on or after the start date." }]);
    await prisma.exam.update({
        where: { id },
        data: {
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.shortName !== undefined && { shortName: patch.shortName ?? null }),
            ...(patch.startDate !== undefined && { startDate: patch.startDate ? toDbDate(patch.startDate) : null }),
            ...(patch.endDate !== undefined && { endDate: patch.endDate ? toDbDate(patch.endDate) : null }),
        },
    });
    await audit(ctx, { action: "exam.update", entity: "Exam", entityId: id, after: { detail: `Edited exam "${patch.name ?? exam.name}"` } });
    return getExam(id);
}

/** Full/pass marks and schedule per subject. Full marks cannot drop below marks already entered. */
export async function updateSubjects(id, { items }, ctx) {
    const exam = await findExam(id);
    if (!["DRAFT", "MARKS_OPEN"].includes(exam.status)) throw conflict("Marks are locked. Reopen marks entry to change the subject setup.");
    const ids = items.map((i) => i.examSubjectId);
    const rows = await prisma.examSubject.findMany({ where: { id: { in: ids }, examId: id }, include: { subject: { select: { name: true } } } });
    if (rows.length !== new Set(ids).size) throw badRequest("Some subjects are not part of this exam.");
    const max = await prisma.mark.groupBy({ by: ["examSubjectId"], where: { examSubjectId: { in: ids } }, _max: { obtained: true } });
    const maxBy = new Map(max.map((m) => [m.examSubjectId, num(m._max.obtained) ?? 0]));
    const name = new Map(rows.map((r) => [r.id, r.subject.name]));
    const errors = items.flatMap((it, i) => ((maxBy.get(it.examSubjectId) ?? 0) > it.fullMarks ? [{ path: `items.${i}.fullMarks`, message: `${name.get(it.examSubjectId)}: marks up to ${maxBy.get(it.examSubjectId)} are already entered.` }] : []));
    if (errors.length) throw conflict(errors[0].message, errors);
    await tx(async (t) => {
        for (const it of items) {
            await t.examSubject.update({
                where: { id: it.examSubjectId },
                data: {
                    fullMarks: it.fullMarks,
                    passMarks: it.passMarks,
                    ...(it.examDate !== undefined && { examDate: it.examDate ? toDbDate(it.examDate) : null }),
                    ...(it.startTime !== undefined && { startTime: it.startTime ?? null }),
                },
            });
        }
        await audit(ctx, { action: "exam.subjects", entity: "Exam", entityId: id, after: { detail: `Updated ${items.length} subject${items.length > 1 ? "s" : ""} of "${exam.name}"` } }, t);
    });
    return getExam(id);
}

export async function deleteExam(id, ctx) {
    const exam = await findExam(id);
    if (exam.status !== "DRAFT") throw conflict("Only a draft exam can be deleted.");
    const marks = await prisma.mark.count({ where: { examSubject: { examId: id } } });
    if (marks) throw conflict("This exam already has marks and cannot be deleted.");
    await tx(async (t) => {
        await t.exam.delete({ where: { id } });
        await audit(ctx, { action: "exam.delete", entity: "Exam", entityId: id, before: { name: exam.name }, after: { detail: `Deleted draft exam "${exam.name}"` } }, t);
    });
    return { id };
}

/** DRAFT → MARKS_OPEN → LOCKED, LOCKED → MARKS_OPEN (reopen), MARKS_OPEN → DRAFT (only without marks). */
export async function setStatus(id, to, ctx) {
    const exam = await findExam(id);
    if (exam.status === to) return listExamsOne(id);
    if (!STATUS_FLOW[exam.status].includes(to)) throw conflict(exam.status === "PUBLISHED" ? "Results are published. Only the Super Admin can unpublish." : `Cannot move from ${exam.status} to ${to}.`);
    if (to === "DRAFT" && (await prisma.mark.count({ where: { examSubject: { examId: id } } }))) throw conflict("Marks are already entered; lock the exam instead.");
    await tx(async (t) => {
        // Conditional update: two admins clicking at once cannot skip a step.
        const r = await t.exam.updateMany({ where: { id, status: exam.status }, data: { status: to } });
        if (!r.count) throw conflict("The exam changed meanwhile. Reload and try again.");
        const verb = { MARKS_OPEN: exam.status === "LOCKED" ? "Reopened marks entry" : "Opened marks entry", LOCKED: "Locked marks", DRAFT: "Moved back to draft" }[to];
        await audit(ctx, { action: "exam.status", entity: "Exam", entityId: id, before: { status: exam.status }, after: { status: to, detail: `${verb} for "${exam.name}"` } }, t);
    });
    return listExamsOne(id);
}

async function listExamsOne(id) {
    return (await listExams()).find((e) => e.id === id) ?? examOut(await findExam(id));
}

/* ------------------------------ marks entry ------------------------------ */

/** Section + subject pairs the user may enter marks for (teacher: own assignments). */
export async function marksOptions(user) {
    if (user.role === ROLE_KEYS.TEACHER) return (await teacherAssignments(user.staffId ?? "")).map((a) => ({ value: `${a.sectionId}|${a.subjectId}`, label: a.label, sectionId: a.sectionId, subjectId: a.subjectId }));
    const sections = await prisma.section.findMany({
        where: { class: { isActive: true } },
        include: { class: { select: { name: true, order: true, subjects: { where: { isActive: true }, orderBy: { order: "asc" }, select: { id: true, name: true } } } } },
    });
    return sections
        .sort((a, b) => a.class.order - b.class.order || a.name.localeCompare(b.name))
        .flatMap((s) => s.class.subjects.map((sub) => ({ value: `${s.id}|${sub.id}`, label: `${sectionLabel(s)} · ${sub.name}`, sectionId: s.id, subjectId: sub.id })));
}

/** Teacher: must teach this subject in this section (current session). 404 otherwise, like every own scope. */
async function assertMarksScope(user, sectionId, subjectId, sessionId) {
    if (can(user, "exams.manage")) return;
    if (!can(user, "marks.enter")) throw forbidden();
    if (user.role !== ROLE_KEYS.TEACHER) return;
    const a = user.staffId && (await prisma.teacherAssignment.findFirst({ where: { staffId: user.staffId, sectionId, subjectId, sessionId }, select: { id: true } }));
    if (!a) throw notFound();
}

async function sheetContext(examId, sectionId, subjectId) {
    const exam = await findExam(examId);
    const section = await findSection(sectionId);
    if (!section) throw notFound();
    const es = await prisma.examSubject.findFirst({ where: { examId, subjectId, subject: { classId: section.classId } }, include: { subject: { include: { class: { select: { gradingMode: true } } } } } });
    if (!es) throw notFound("This subject is not part of the exam for this class.");
    return { exam, section, es, remarksMode: es.subject.class.gradingMode === "REMARKS" };
}

export async function getMarksSheet(examId, { sectionId, subjectId }, user) {
    const { exam, section, es, remarksMode } = await sheetContext(examId, sectionId, subjectId);
    await assertMarksScope(user, sectionId, subjectId, exam.sessionId);
    const [roster, teacher] = await Promise.all([
        sectionRoster(sectionId, exam.sessionId),
        prisma.teacherAssignment.findFirst({ where: { sessionId: exam.sessionId, sectionId, subjectId }, include: { staff: { select: { name: true } } } }),
    ]);
    const marks = await prisma.mark.findMany({ where: { examSubjectId: es.id, enrollmentId: { in: roster.map((r) => r.enrollmentId) } } });
    const byEnrollment = new Map(marks.map((m) => [m.enrollmentId, m]));
    return {
        exam: { id: exam.id, name: exam.name, status: exam.status },
        examSubjectId: es.id,
        sectionId,
        subjectId,
        section: sectionLabel(section),
        subject: es.subject.name,
        teacher: teacher?.staff.name ?? "—",
        fullMarks: es.fullMarks,
        passMarks: es.passMarks,
        gradingMode: remarksMode ? "REMARKS" : "MARKS",
        editable: exam.status === "MARKS_OPEN",
        rows: roster.map((r) => {
            const m = byEnrollment.get(r.enrollmentId);
            return { enrollmentId: r.enrollmentId, roll: r.roll, name: r.name, obtained: num(m?.obtained), absent: m?.absent ?? false, remarks: m?.remarks ?? null };
        }),
    };
}

/**
 * Saves the rows sent (others untouched). An empty row (no number, not absent, no remark) clears the mark.
 * Corrections to marks already entered are audited; first entries are routine and are not.
 */
export async function saveMarks(examId, { sectionId, subjectId, rows }, user, ctx) {
    const { exam, section, es, remarksMode } = await sheetContext(examId, sectionId, subjectId);
    await assertMarksScope(user, sectionId, subjectId, exam.sessionId);
    if (exam.status !== "MARKS_OPEN") throw conflict(exam.status === "PUBLISHED" ? "Results are published; marks are locked." : "Marks entry is closed for this exam.");

    const roster = new Set((await sectionRoster(sectionId, exam.sessionId)).map((r) => r.enrollmentId));
    if (rows.some((r) => !roster.has(r.enrollmentId))) throw badRequest("Some students are not in this class.");
    if (new Set(rows.map((r) => r.enrollmentId)).size !== rows.length) throw badRequest("A student appears twice.");
    const errors = rows.flatMap((r, i) => (r.obtained != null && r.obtained > es.fullMarks ? [{ path: `rows.${i}.obtained`, message: `Marks cannot be above ${es.fullMarks}.` }] : []));
    if (errors.length) throw badRequest(errors[0].message, errors);

    const existing = new Map((await prisma.mark.findMany({ where: { examSubjectId: es.id, enrollmentId: { in: rows.map((r) => r.enrollmentId) } } })).map((m) => [m.enrollmentId, m]));
    let saved = 0;
    let cleared = 0;
    let corrected = 0;
    await tx(async (t) => {
        // Re-check inside the transaction: a lock that lands mid-save must win.
        const fresh = await t.exam.findUnique({ where: { id: examId }, select: { status: true } });
        if (fresh?.status !== "MARKS_OPEN") throw conflict("Marks entry was closed while you were saving.");
        for (const r of rows) {
            const value = r.absent ? null : r.obtained;
            const remarks = remarksMode ? (r.remarks || null) : null;
            const prev = existing.get(r.enrollmentId);
            if (!r.absent && value == null && !remarks) {
                if (prev) {
                    await t.mark.delete({ where: { id: prev.id } });
                    cleared++;
                    if (isEntered({ obtained: num(prev.obtained), absent: prev.absent, remarks: prev.remarks }, remarksMode)) corrected++;
                }
                continue;
            }
            if (prev && num(prev.obtained) === value && prev.absent === r.absent && (prev.remarks ?? null) === remarks) continue;
            if (prev && isEntered({ obtained: num(prev.obtained), absent: prev.absent, remarks: prev.remarks }, remarksMode)) corrected++;
            await t.mark.upsert({
                where: { enrollmentId_examSubjectId: { enrollmentId: r.enrollmentId, examSubjectId: es.id } },
                create: { enrollmentId: r.enrollmentId, examSubjectId: es.id, obtained: value, absent: r.absent, remarks, enteredById: user.id },
                update: { obtained: value, absent: r.absent, remarks, enteredById: user.id },
            });
            saved++;
        }
        if (corrected) await audit(ctx, { action: "marks.update", entity: "Mark", entityId: es.id, after: { detail: `Corrected ${corrected} mark${corrected > 1 ? "s" : ""}: ${exam.name}, ${sectionLabel(section)} · ${es.subject.name}` } }, t);
    });
    const entered = await prisma.mark.count({ where: { examSubjectId: es.id, enrollmentId: { in: [...roster] }, OR: [{ obtained: { not: null } }, { absent: true }, ...(remarksMode ? [{ remarks: { not: null } }] : [])] } });
    return { saved, cleared, entered, total: roster.size };
}

/* ------------------------------ results ------------------------------ */

/**
 * Computes results for one section of an exam from the current marks.
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} db
 */
async function computeSection(db, exam, section, scale, tie) {
    const subjects = await db.examSubject.findMany({
        where: { examId: exam.id, subject: { classId: section.classId } },
        include: { subject: { select: { name: true, order: true, class: { select: { gradingMode: true } } } } },
    });
    subjects.sort((a, b) => a.subject.order - b.subject.order);
    const remarksMode = subjects[0]?.subject.class.gradingMode === "REMARKS";
    const roster = await sectionRoster(section.id, exam.sessionId);
    const marks = await db.mark.findMany({ where: { examSubjectId: { in: subjects.map((s) => s.id) }, enrollmentId: { in: roster.map((r) => r.enrollmentId) } } });
    const byEnrollment = new Map();
    for (const m of marks) {
        if (!byEnrollment.has(m.enrollmentId)) byEnrollment.set(m.enrollmentId, new Map());
        byEnrollment.get(m.enrollmentId).set(m.examSubjectId, { obtained: num(m.obtained), absent: m.absent, remarks: m.remarks });
    }
    const refs = subjects.map((s) => ({ examSubjectId: s.id, name: s.subject.name, fullMarks: s.fullMarks, passMarks: s.passMarks }));
    const rows = withPositions(
        roster.map((r) => ({
            enrollmentId: r.enrollmentId,
            studentId: r.studentId,
            studentUid: r.studentUid,
            roll: r.roll,
            name: r.name,
            ...computeResult({ subjects: refs, marks: byEnrollment.get(r.enrollmentId) ?? new Map(), scale, remarksMode }),
        })),
        tie ?? (await tieBreak()),
    );
    return { subjects: refs.map((s) => s.name), rows, remarksMode };
}

const stats = (rows) => ({
    students: rows.length,
    passed: rows.filter((r) => !r.failed && r.complete && !r.remarksMode).length,
    aPlus: rows.filter((r) => r.grade === "A+").length,
    incomplete: rows.filter((r) => !r.complete).length,
});

/** Tabulation for a section. Published exams read the frozen snapshots. */
export async function getTabulation(examId, sectionId) {
    const exam = await findExam(examId);
    const section = await findSection(sectionId);
    if (!section) throw notFound();
    const base = { exam: examOut(exam), section: sectionLabel(section), published: exam.status === "PUBLISHED" };
    if (exam.status === "PUBLISHED") {
        const snaps = await prisma.resultSnapshot.findMany({ where: { examId, enrollment: { sectionId } } });
        const rows = snaps.map((s) => ({ enrollmentId: s.enrollmentId, ...s.payload, position: s.position })).sort((a, b) => a.roll - b.roll);
        return { ...base, subjects: rows[0]?.lines.map((l) => l.subject) ?? [], remarksMode: rows[0]?.remarksMode ?? false, rows, stats: stats(rows) };
    }
    const scale = prepareScale(await getGradeScale());
    const t = await computeSection(prisma, exam, section, scale);
    return { ...base, subjects: t.subjects, remarksMode: t.remarksMode, rows: t.rows, stats: stats(t.rows) };
}

/**
 * Writes snapshots for every section that has subjects in this exam. Call inside a transaction.
 * @returns {Promise<{ students: number, incomplete: number, sections: number }>}
 */
async function writeSnapshots(t, exam, publishedAt) {
    const scale = prepareScale(await getGradeScale());
    const classIds = (await t.examSubject.findMany({ where: { examId: exam.id }, select: { subject: { select: { classId: true } } } })).map((x) => x.subject.classId);
    const sections = await t.section.findMany({ where: { classId: { in: [...new Set(classIds)] } }, include: { class: { select: { id: true, name: true, order: true } } } });
    const remarks = new Map((await t.resultRemark.findMany({ where: { examId: exam.id } })).map((r) => [r.enrollmentId, r.remark]));
    const data = [];
    let incomplete = 0;
    for (const section of sections) {
        const { rows } = await computeSection(t, exam, section, scale);
        const label = sectionLabel(section);
        for (const r of rows) {
            if (!r.complete) incomplete++;
            const payload = {
                student: { id: r.studentId, name: r.name, studentUid: r.studentUid },
                studentId: r.studentId,
                name: r.name,
                roll: r.roll,
                section: label,
                outOf: rows.length,
                lines: r.lines,
                total: r.total,
                fullTotal: r.fullTotal,
                percent: r.percent,
                gpa: r.gpa,
                grade: r.grade,
                failed: r.failed,
                complete: r.complete,
                remarksMode: r.remarksMode,
                remark: remarks.get(r.enrollmentId) ?? null,
            };
            data.push({
                examId: exam.id,
                enrollmentId: r.enrollmentId,
                total: new Prisma.Decimal(r.total),
                fullMarks: r.fullTotal,
                percent: new Prisma.Decimal(r.percent),
                grade: r.grade,
                gpa: r.gpa == null ? null : new Prisma.Decimal(r.gpa),
                position: r.position,
                isPass: !r.failed,
                payload,
                publishedAt,
            });
        }
    }
    if (data.length) await t.resultSnapshot.createMany({ data });
    return { students: data.length, incomplete, sections: sections.length };
}

/** Students with missing marks across the exam (publish pre-check). */
async function incompleteCount(exam) {
    const scale = prepareScale(await getGradeScale());
    const classIds = (await prisma.examSubject.findMany({ where: { examId: exam.id }, select: { subject: { select: { classId: true } } } })).map((x) => x.subject.classId);
    const sections = await prisma.section.findMany({ where: { classId: { in: [...new Set(classIds)] } }, include: { class: { select: { id: true, name: true, order: true } } } });
    let n = 0;
    const where = [];
    for (const s of sections) {
        const { rows } = await computeSection(prisma, exam, s, scale);
        const missing = rows.filter((r) => !r.complete).length;
        if (missing) {
            n += missing;
            where.push(sectionLabel(s));
        }
    }
    return { n, where };
}

export async function publish(id, { sendSms, allowIncomplete }, ctx) {
    const exam = await findExam(id);
    if (exam.status === "PUBLISHED") throw conflict("Results are already published.");
    if (exam.status !== "LOCKED") throw conflict("Lock marks entry first, review the tabulation, then publish.");
    if (!allowIncomplete) {
        const { n, where } = await incompleteCount(exam);
        if (n) throw conflict(`${n} student${n > 1 ? "s" : ""} still have missing marks (${where.slice(0, 4).join(", ")}${where.length > 4 ? " …" : ""}). Missing subjects count as failed.`, [{ path: "allowIncomplete", message: "INCOMPLETE", count: n }]);
    }
    const publishedAt = new Date();
    const result = await tx(
        async (t) => {
            const r = await t.exam.updateMany({ where: { id, status: "LOCKED" }, data: { status: "PUBLISHED", publishedAt, publishedById: ctx.actorId } });
            if (!r.count) throw conflict("The exam changed meanwhile. Reload and try again.");
            await t.resultSnapshot.deleteMany({ where: { examId: id } });
            const w = await writeSnapshots(t, exam, publishedAt);
            await audit(ctx, { action: "results.publish", entity: "Exam", entityId: id, after: { detail: `Published "${exam.name}" for ${w.students} students${w.incomplete ? ` (${w.incomplete} with missing marks)` : ""}` } }, t);
            return w;
        },
        { timeout: 60_000 },
    );
    let sms = false;
    if (sendSms) {
        try {
            await enqueue(QUEUES.RESULT, "result.notify", { examId: id }, { jobId: `result-notify-${id}-${publishedAt.getTime()}` });
            sms = true;
        } catch (err) {
            logger.error({ err: err.message, examId: id }, "could not queue result SMS");
        }
    }
    return { ...(await listExamsOne(id)), published: result.students, incomplete: result.incomplete, smsQueued: sms };
}

/** Super Admin only (route). Snapshots are removed; SMS already sent cannot be recalled. */
export async function unpublish(id, ctx) {
    const exam = await findExam(id);
    if (exam.status !== "PUBLISHED") throw conflict("This exam is not published.");
    await tx(async (t) => {
        const r = await t.exam.updateMany({ where: { id, status: "PUBLISHED" }, data: { status: "LOCKED", publishedAt: null, publishedById: null } });
        if (!r.count) throw conflict("The exam changed meanwhile. Reload and try again.");
        const d = await t.resultSnapshot.deleteMany({ where: { examId: id } });
        await audit(ctx, { action: "results.unpublish", entity: "Exam", entityId: id, before: { status: "PUBLISHED", publishedAt: exam.publishedAt }, after: { status: "LOCKED", detail: `Unpublished "${exam.name}" (${d.count} results withdrawn)` } }, t);
    });
    return listExamsOne(id);
}

/**
 * Backfill for exams that are PUBLISHED but have no snapshots (demo seed, imports). Keeps publishedAt.
 * @returns {Promise<{ examId: string, name: string, students: number }[]>}
 */
export async function backfillSnapshots() {
    const exams = await prisma.exam.findMany({ where: { status: "PUBLISHED", results: { none: {} } } });
    const out = [];
    for (const exam of exams) {
        const w = await tx((t) => writeSnapshots(t, exam, exam.publishedAt ?? new Date()), { timeout: 120_000 });
        out.push({ examId: exam.id, name: exam.name, students: w.students });
    }
    return out;
}

/* ------------------------------ portal / profile ------------------------------ */

/** Guardian: own child only. Staff: students.view (teachers: own sections). Everyone else 404/403. */
async function assertStudentAccess(user, studentId) {
    if (user.role === ROLE_KEYS.STUDENT) {
        if (user.studentId !== studentId) throw notFound();
        return;
    }
    if (!can(user, "students.view")) throw forbidden();
    if (user.role === ROLE_KEYS.TEACHER) await getStudent(studentId, user); // throws 404 outside the teacher's sections
}

const snapshotOut = (s) => ({
    exam: { id: s.exam.id, name: s.exam.name, publishedAt: s.publishedAt.toISOString() },
    ...s.payload,
    position: s.position,
});

/** Published results of a student across sessions, oldest first. */
export async function studentResults(studentId, user) {
    await assertStudentAccess(user, studentId);
    const snaps = await prisma.resultSnapshot.findMany({
        where: { enrollment: { studentId }, exam: { status: "PUBLISHED" } },
        include: { exam: { select: { id: true, name: true, startDate: true } } },
        orderBy: { publishedAt: "asc" },
    });
    return snaps.map(snapshotOut);
}

/** One marksheet. Unpublished or not this student's → 404. */
export async function studentMarksheet(studentId, examId, user) {
    await assertStudentAccess(user, studentId);
    const s = await prisma.resultSnapshot.findFirst({ where: { examId, enrollment: { studentId }, exam: { status: "PUBLISHED" } }, include: { exam: { select: { id: true, name: true } } } });
    if (!s) throw notFound();
    return snapshotOut(s);
}

/** For the result SMS job. */
export async function snapshotRecipients(examId) {
    const exam = await prisma.exam.findUnique({ where: { id: examId }, select: { name: true, shortName: true, status: true } });
    if (!exam || exam.status !== "PUBLISHED") return { exam: null, rows: [] };
    const snaps = await prisma.resultSnapshot.findMany({ where: { examId, enrollment: { student: { status: "ACTIVE" } } }, select: { gpa: true, grade: true, enrollment: { select: { student: { select: { id: true, name: true, guardianPhone: true } } } } } });
    return { exam, rows: snaps.map((s) => ({ studentId: s.enrollment.student.id, name: s.enrollment.student.name, phone: s.enrollment.student.guardianPhone, gpa: s.gpa == null ? null : Number(s.gpa).toFixed(2), grade: s.grade })) };
}

/**
 * Admit card for the next unpublished exam: schedule of the student's class and the dues hold.
 * Hold threshold: setting cards.admitDueLimit (taka; null/0 = never hold).
 */
export async function admitCard(studentId, user) {
    await assertStudentAccess(user, studentId);
    const s = await getStudent(studentId, null);
    const [upcoming, dues, holdAbove] = await Promise.all([upcomingExams(), duesForStudents([studentId]), admitDueLimit()]);
    const due = dues.get(studentId) ?? 0;
    const held = Boolean(holdAbove) && due > holdAbove;
    const next = upcoming[0];
    if (!next || !s.classId) return { exam: null, schedule: [], due, held, holdAbove };
    const subjects = await prisma.examSubject.findMany({ where: { examId: next.id, subject: { classId: s.classId } }, include: { subject: { select: { name: true, order: true } } } });
    const schedule = subjects
        .sort((a, b) => (fromDbDate(a.examDate) ?? "9").localeCompare(fromDbDate(b.examDate) ?? "9") || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.subject.order - b.subject.order)
        .map((x) => ({ subject: x.subject.name, date: fromDbDate(x.examDate), time: x.startTime, fullMarks: x.fullMarks }));
    return { exam: next, schedule, due, held, holdAbove };
}
