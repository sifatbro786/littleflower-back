import { env } from "#config/env.js";
import { hashPassword } from "#core/auth.js";
import { addDays, dhakaDateString, toDbDate } from "#core/dates.js";

import * as demo from "./demo-data.js";

/**
 * Demo seed: port of littleflower-front lib/demo/seed.js so the panel shows the same numbers on real tables.
 * Runs only with SEED_DEMO=true, never in production, and only on a database with no students yet.
 * Everything is written in one transaction: a failure leaves the database as it was.
 * No explicit ids: rows are matched by natural keys (class name, subject name, studentUid, email …).
 * @param {import("@prisma/client").PrismaClient} prisma
 */
export async function seedDemo(prisma) {
    if (env.isProd) throw new Error("Demo seed is blocked in production");
    if (!env.SEED_DEMO_PASSWORD) throw new Error("SEED_DEMO_PASSWORD is required when SEED_DEMO=true");
    if ((await prisma.student.count()) > 0) {
        console.log("  demo skipped: students already exist");
        return;
    }

    // One hash for every demo account (same password); argon2 160 times would take ~10 s.
    const passwordHash = await hashPassword(env.SEED_DEMO_PASSWORD);

    await prisma.$transaction(async (tx) => seed(tx, passwordHash), { maxWait: 10_000, timeout: 300_000 });
}

const chunk = (arr, n = 5000) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const slugify = (s) =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

/** @param {import("@prisma/client").Prisma.TransactionClient} tx */
async function seed(tx, passwordHash) {
    const roles = new Map((await tx.role.findMany({ select: { id: true, key: true } })).map((r) => [r.key, r.id]));
    const session = await tx.academicSession.findUniqueOrThrow({ where: { name: demo.session.name } });

    /* ---------------- academic lookups (created by bootstrap) ---------------- */
    const dbClasses = await tx.class.findMany({ include: { sections: true, subjects: true } });
    const classId = new Map(); // demo class id → db id
    const sectionId = new Map(); // demo section id → db id
    const subjectId = new Map(); // demo subject id → db id
    for (const c of demo.classes) {
        const db = dbClasses.find((x) => x.name === c.name);
        if (!db) throw new Error(`Class "${c.name}" missing: run the bootstrap seed first`);
        classId.set(c.id, db.id);
        const sec = db.sections.find((s) => s.name === demo.sections[0].name);
        if (!sec) throw new Error(`Section "${demo.sections[0].name}" missing in ${c.name}: run the bootstrap seed first`);
        sectionId.set(`${c.id}-a`, sec.id);
    }
    for (const s of demo.subjects) {
        const db = dbClasses.find((x) => x.id === classId.get(s.classId)).subjects.find((x) => x.name === s.name);
        if (!db) throw new Error(`Subject "${s.name}" missing for ${s.classId}`);
        subjectId.set(s.id, db.id);
    }

    /* ---------------- users + staff ---------------- */
    const userId = new Map(); // demo user id → db id
    const deskUsers = [
        { id: "usr-admin", name: "Mahmuda Khanam", email: "admin@littleflower.demo", role: "ADMIN" },
        { id: "usr-office", name: "Office Desk", email: "office@littleflower.demo", role: "OFFICE" },
        { id: "usr-accounts", name: "Accounts Desk", email: "accounts@littleflower.demo", role: "ACCOUNTANT" },
    ];
    for (const u of deskUsers) {
        const row = await tx.user.create({ data: { name: u.name, email: u.email, passwordHash, roleId: roles.get(u.role) } });
        userId.set(u.id, row.id);
    }

    const staffId = new Map();
    for (const [i, t] of demo.staff.entries()) {
        // t02 keeps the demo login shown on the login page
        const email = t.id === "t02" ? "teacher@littleflower.demo" : t.email;
        const user = await tx.user.create({
            data: { name: t.name, email, phone: t.phone.replace(/\D/g, ""), passwordHash, roleId: roles.get(t.id === "t01" ? "ADMIN" : "TEACHER") },
        });
        userId.set(`usr-${t.id}`, user.id);
        const row = await tx.staff.create({
            data: {
                userId: user.id,
                name: t.name,
                designation: t.designation,
                qualification: t.qualification,
                phone: t.phone,
                email: t.email,
                order: i + 1,
                joinedAt: toDbDate(t.joinedAt),
                showOnWebsite: false, // fictional people never reach the public site
            },
        });
        staffId.set(t.id, row.id);
    }
    const formerRole = roles.get("TEACHER");
    await tx.user.create({ data: { name: "Former Teacher", email: "former@littleflower.demo", passwordHash, roleId: formerRole, status: "DISABLED" } });

    await tx.classTeacher.createMany({
        data: demo.sections.map((s) => ({ sessionId: session.id, sectionId: sectionId.get(s.id), staffId: staffId.get(s.classTeacherId) })),
    });
    await tx.teacherAssignment.createMany({
        data: demo.assignments.map((a) => ({
            sessionId: session.id,
            sectionId: sectionId.get(a.sectionId),
            subjectId: subjectId.get(a.subjectId),
            staffId: staffId.get(a.staffId),
        })),
    });

    /* ---------------- students + enrollments ---------------- */
    const studentRole = roles.get("STUDENT");
    const studentUsers = await tx.user.createManyAndReturn({
        data: demo.students.map((s) => ({ name: s.name, username: s.studentUid.toLowerCase(), passwordHash, roleId: studentRole })),
        select: { id: true, username: true },
    });
    const userByUsername = new Map(studentUsers.map((u) => [u.username, u.id]));

    const students = await tx.student.createManyAndReturn({
        data: demo.students.map((s) => ({
            studentUid: s.studentUid,
            name: s.name,
            gender: s.gender,
            dob: toDbDate(s.dob),
            bloodGroup: s.bloodGroup,
            fatherName: s.fatherName,
            motherName: s.motherName,
            guardianPhone: s.guardianPhone.replace(/\D/g, ""),
            address: s.address,
            admissionDate: toDbDate(s.admissionDate),
            status: s.status,
            userId: userByUsername.get(s.studentUid.toLowerCase()),
        })),
        select: { id: true, studentUid: true },
    });
    const byUid = new Map(students.map((s) => [s.studentUid, s.id]));
    const studentId = new Map(demo.students.map((s) => [s.id, byUid.get(s.studentUid)]));

    const enrollments = await tx.enrollment.createManyAndReturn({
        data: demo.enrollments.map((e) => ({ studentId: studentId.get(e.studentId), sessionId: session.id, sectionId: sectionId.get(e.sectionId), roll: e.roll })),
        select: { id: true, studentId: true },
    });
    const enrByStudent = new Map(enrollments.map((e) => [e.studentId, e.id]));
    const enrollmentId = new Map(demo.enrollments.map((e) => [e.id, enrByStudent.get(studentId.get(e.studentId))]));

    /* ---------------- exams + marks ---------------- */
    const examId = new Map();
    for (const e of demo.exams) {
        const row = await tx.exam.create({
            data: {
                sessionId: session.id,
                name: e.name,
                shortName: e.short,
                status: e.status,
                startDate: toDbDate(e.startDate),
                endDate: toDbDate(e.endDate),
                publishedAt: e.publishedAt ? new Date(`${e.publishedAt}T11:00:00+06:00`) : null,
            },
        });
        examId.set(e.id, row.id);
    }
    const examSubjects = await tx.examSubject.createManyAndReturn({
        data: demo.examSubjects.map((es) => ({ examId: examId.get(es.examId), subjectId: subjectId.get(es.subjectId), fullMarks: es.fullMarks, passMarks: es.passMarks })),
        select: { id: true, examId: true, subjectId: true },
    });
    const esKey = new Map(examSubjects.map((x) => [`${x.examId}|${x.subjectId}`, x.id]));
    const examSubjectId = new Map(demo.examSubjects.map((es) => [es.id, esKey.get(`${examId.get(es.examId)}|${subjectId.get(es.subjectId)}`)]));

    for (const part of chunk(demo.marks)) {
        await tx.mark.createMany({
            data: part.map((m) => ({
                enrollmentId: enrollmentId.get(m.enrollmentId),
                examSubjectId: examSubjectId.get(m.examSubjectId),
                obtained: m.obtained,
                absent: m.absent,
                enteredById: m.enteredById ? userId.get(`usr-${m.enteredById}`) : null,
            })),
        });
    }
    // ResultSnapshots for the PUBLISHED demo exams are written after this transaction (prisma/seed.js → backfillSnapshots).

    /* ---------------- routine ---------------- */
    const periods = new Map((await tx.period.findMany()).map((p) => [p.number, p.id]));
    await tx.routineSlot.createMany({
        data: demo.routineSlots.map((r) => ({
            sessionId: session.id,
            sectionId: sectionId.get(r.sectionId),
            day: r.day,
            periodId: periods.get(demo.periods.find((p) => p.id === r.periodId).number),
            subjectId: subjectId.get(r.subjectId),
            staffId: staffId.get(r.staffId),
        })),
    });

    /* ---------------- holidays + attendance ---------------- */
    await tx.holiday.createMany({ data: demo.holidays.map((h) => ({ date: toDbDate(h.date), title: h.title })), skipDuplicates: true });

    // Same generator as littleflower-front lib/dashboard/_shared.js attendanceStatus()
    const holidaySet = new Set(demo.holidays.map((h) => h.date));
    const isSchoolDay = (iso) => ![5, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay()) && !holidaySet.has(iso);
    const PENDING_TODAY = new Set(["c4-a"]);
    const today = demo.DEMO_TODAY;
    const takerBySection = new Map(demo.sections.map((s) => [s.id, userId.get(`usr-${s.classTeacherId}`)]));
    const attendance = [];
    for (let d = demo.session.startDate; d <= today && d <= dhakaDateString(); d = addDays(d, 1)) {
        if (!isSchoolDay(d)) continue;
        for (const en of demo.enrollments) {
            if (d === today && PENDING_TODAY.has(en.sectionId)) continue;
            const r = demo.hash(`att-${en.id}-${d}`);
            const weak = demo.hash(`weak-${en.studentId}`) < 0.12 ? 0.06 : 0;
            const status = r < 0.035 + weak ? "ABSENT" : r < 0.06 + weak ? "LATE" : "PRESENT";
            attendance.push({ enrollmentId: enrollmentId.get(en.id), date: toDbDate(d), status, takenById: takerBySection.get(en.sectionId) });
        }
    }
    for (const part of chunk(attendance)) await tx.attendance.createMany({ data: part });

    /* ---------------- fees ---------------- */
    const heads = new Map((await tx.feeHead.findMany()).map((h) => [h.code, h.id]));
    const headId = (demoId) => heads.get(demoId.replace(/^fh-/, ""));
    await tx.feeStructure.createMany({
        data: demo.feeStructures.map((f) => ({ sessionId: session.id, classId: classId.get(f.classId), feeHeadId: headId(f.feeHeadId), amount: f.amount })),
    });
    // Sibling waiver (10% tuition) exactly as the demo generator decides it
    await tx.studentConcession.createMany({
        data: demo.students
            .filter((s) => demo.hash(`sib-${s.id}`) < 0.1)
            .map((s) => ({ studentId: studentId.get(s.id), sessionId: session.id, feeHeadId: heads.get("tuition"), percent: 10, reason: "Sibling waiver" })),
    });

    const invoices = await tx.invoice.createManyAndReturn({
        data: demo.invoices.map((i) => ({
            enrollmentId: enrollmentId.get(i.enrollmentId),
            feeHeadId: headId(i.feeHeadId),
            month: i.month,
            amount: i.amount,
            discount: i.discount,
            discountNote: i.discount ? "Sibling waiver 10%" : null,
            dueDate: toDbDate(`${i.month}-10`),
        })),
        select: { id: true, enrollmentId: true, feeHeadId: true, month: true },
    });
    const invKey = new Map(invoices.map((i) => [`${i.enrollmentId}|${i.feeHeadId}|${i.month}`, i.id]));
    const invoiceId = new Map(demo.invoices.map((i) => [i.id, invKey.get(`${enrollmentId.get(i.enrollmentId)}|${headId(i.feeHeadId)}|${i.month}`)]));

    const seenTran = new Set();
    const payments = await tx.payment.createManyAndReturn({
        data: demo.payments.map((p) => {
            const paidAt = new Date(p.paidAt);
            // the demo generator's random tran ids could in theory collide; tranId is unique
            const tranId = p.tranId && seenTran.has(p.tranId) ? `${p.tranId}-${p.receiptNo}` : p.tranId;
            if (tranId) seenTran.add(tranId);
            return {
                receiptNo: p.receiptNo,
                studentId: studentId.get(p.studentId),
                amount: p.amount,
                method: p.method,
                channel: p.tranId ? "ONLINE" : "COUNTER",
                tranId,
                collectedById: p.collectedById ? userId.get(p.collectedById) : null,
                paidAt,
                paidOn: toDbDate(dhakaDateString(paidAt)),
            };
        }),
        select: { id: true, receiptNo: true },
    });
    const payByReceipt = new Map(payments.map((p) => [p.receiptNo, p.id]));
    const paymentId = new Map(demo.payments.map((p) => [p.id, payByReceipt.get(p.receiptNo)]));

    await tx.allocation.createMany({
        data: demo.allocations.map((a) => ({ paymentId: paymentId.get(a.paymentId), invoiceId: invoiceId.get(a.invoiceId), amount: a.amount })),
    });
    for (const p of demo.payments.filter((x) => x.status === "REVERSED")) {
        const reversedAt = new Date("2026-10-18T12:40:00+06:00");
        await tx.paymentReversal.create({
            data: { paymentId: paymentId.get(p.id), reason: p.reversalReason, reversedById: userId.get("usr-accounts"), reversedAt, reversedOn: toDbDate(dhakaDateString(reversedAt)) },
        });
    }
    // Receipt counter continues after the highest seeded number (plan: seed policy)
    const year = demo.session.name;
    const maxSeq = Math.max(0, ...demo.payments.map((p) => Number(p.receiptNo.split("-").at(-1))));
    await tx.counter.upsert({ where: { key: `receipt:${year}` }, create: { key: `receipt:${year}`, value: maxSeq }, update: { value: maxSeq } });

    /* ---------------- notices, sms, contact, audit ---------------- */
    for (const n of demo.staffNotices) {
        const [audience, cls] = n.audience.split(":");
        await tx.notice.create({
            data: {
                slug: `${slugify(n.title)}-${n.id}`,
                title: n.title,
                audience,
                classId: cls ? classId.get(cls) : null,
                bodyHtml: `<p>${n.body}</p>`,
                excerpt: n.body,
                pinned: n.pinned,
                publishedAt: new Date(n.publishedAt),
            },
        });
    }

    const templates = new Map((await tx.smsTemplate.findMany()).map((t) => [t.type, t.id]));
    await tx.smsLog.createMany({
        data: demo.smsLogs.map((l) => ({
            to: l.to.replace(/\D/g, ""),
            studentId: studentId.get(l.studentId),
            type: l.type,
            templateId: templates.get(l.type),
            body: `[demo] ${l.type.toLowerCase()} message`,
            segments: l.segments,
            isUnicode: l.type === "CUSTOM",
            status: l.status === "PENDING" ? "QUEUED" : l.status,
            providerId: l.providerId,
            attempts: l.status === "FAILED" ? 3 : 1,
            sentAt: new Date(l.sentAt),
            createdAt: new Date(l.sentAt),
        })),
    });

    await tx.contactMessage.createMany({
        data: [
            { name: "Rashida Akter", phone: "01712334455", subject: "Admission", message: "Is admission open for Nursery? What documents are needed?", createdAt: new Date("2026-10-25T19:12:00+06:00") },
            { name: "Md. Faruk Hossain", phone: "01819221100", subject: "Fees", message: "Can I pay the monthly fee by bKash?", createdAt: new Date("2026-10-24T11:40:00+06:00"), readAt: new Date("2026-10-24T12:00:00+06:00"), repliedAt: new Date("2026-10-24T12:05:00+06:00") },
            { name: "Sultana Razia", phone: "01911556677", subject: "General", message: "What time does school end for Class II?", createdAt: new Date("2026-10-22T08:05:00+06:00"), readAt: new Date("2026-10-22T09:00:00+06:00"), repliedAt: new Date("2026-10-22T09:10:00+06:00") },
        ],
    });

    const superAdmin = await tx.user.findFirst({ where: { role: { key: "SUPER_ADMIN" } }, select: { id: true } });
    const actorByName = new Map([
        ["Super Admin", superAdmin?.id ?? null],
        ["Accounts Desk", userId.get("usr-accounts")],
        ["Office Desk", userId.get("usr-office")],
        ...demo.staff.map((t) => [t.name, userId.get(`usr-${t.id}`)]),
    ]);
    await tx.auditLog.createMany({
        data: demo.auditLogs.map((a) => ({
            actorId: actorByName.get(a.actor) ?? null,
            action: a.action,
            entity: a.entity,
            entityId: a.entityId,
            after: { detail: a.detail },
            ip: a.ip,
            createdAt: new Date(a.createdAt),
        })),
    });

    console.log(
        `  demo ok (${students.length} students, ${demo.marks.length} marks, ${attendance.length} attendance rows, ${invoices.length} invoices, ${payments.length} payments)`,
    );
}
