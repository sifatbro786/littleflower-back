import { Prisma } from "@prisma/client";

import { env } from "#config/env.js";
import { audit } from "#core/audit.js";
import { badRequest, conflict, forbidden, notFound } from "#core/errors.js";
import { dhakaDateString, dhakaMonthString, fromDbDate, toDbDate } from "#core/dates.js";
import { logger } from "#core/logger.js";
import { nextCounter, prisma, tx } from "#core/prisma.js";
import { can, ROLE_KEYS } from "#core/rbac.js";
import { redis } from "#core/redis.js";

import { getCurrentSession, sectionLabel } from "#modules/academics/academics.service.js";
import { receiptPrefix as receiptPrefixSetting, studentUidPrefix } from "#modules/settings/settings.service.js";
import { getStudent, listStudents } from "#modules/students/students.service.js";

/**
 * Fees (PRD §6.7). Integer taka everywhere.
 * - Invoice.amount is copied from FeeStructure when the invoice is generated and never edited.
 *   due = amount − discount − allocations of payments that were not reversed (never below 0).
 * - Payments are never edited or deleted; cancelling = one PaymentReversal row (unique per payment).
 * - Receipt numbers come from the Counter row "receipt:<year>" inside the payment transaction:
 *   gap free, never duplicated (rolled-back payment releases its number).
 * - Invoice rows are locked FOR UPDATE while a payment is allocated, so two cashiers (or a cashier and
 *   the gateway IPN) can never allocate the same due twice.
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */
/** @typedef {import("#core/auth.js").AuthUser} AuthUser */

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const METHOD_LABEL = { CASH: "Cash", BANK: "Bank", BKASH: "bKash", NAGAD: "Nagad", ROCKET: "Rocket", CARD: "Card" };
const PAID_SQL = Prisma.sql`
    SELECT a."invoiceId", SUM(a.amount)::int AS amount
    FROM "Allocation" a
    JOIN "Payment" p ON p.id = a."paymentId"
    LEFT JOIN "PaymentReversal" r ON r."paymentId" = p.id
    WHERE r.id IS NULL
    GROUP BY a."invoiceId"`;

/* ------------------------------ reads used by other modules ------------------------------ */

/** @param {string[]} studentIds @returns {Promise<Map<string, number>>} studentId → due (all sessions) */
export async function duesForStudents(studentIds) {
    if (!studentIds.length) return new Map();
    const rows = await prisma.$queryRaw`
        WITH paid AS (${PAID_SQL})
        SELECT e."studentId" AS "studentId",
               SUM(GREATEST(i.amount - i.discount - COALESCE(paid.amount, 0), 0))::int AS due
        FROM "Invoice" i
        JOIN "Enrollment" e ON e.id = i."enrollmentId"
        LEFT JOIN paid ON paid."invoiceId" = i.id
        WHERE e."studentId" IN (${Prisma.join(studentIds.map((id) => Prisma.sql`${id}::uuid`))})
        GROUP BY e."studentId"`;
    return new Map(rows.map((r) => [r.studentId, Number(r.due) || 0]));
}

/** Active students with any due (for "Guardians with dues" SMS and the dashboard). */
export async function studentsWithDues() {
    const rows = await prisma.$queryRaw`
        WITH paid AS (${PAID_SQL})
        SELECT e."studentId" AS "studentId", SUM(GREATEST(i.amount - i.discount - COALESCE(paid.amount, 0), 0))::int AS due
        FROM "Invoice" i JOIN "Enrollment" e ON e.id = i."enrollmentId"
        JOIN "Student" s ON s.id = e."studentId" AND s.status = 'ACTIVE'
        LEFT JOIN paid ON paid."invoiceId" = i.id
        GROUP BY e."studentId" HAVING SUM(GREATEST(i.amount - i.discount - COALESCE(paid.amount, 0), 0)) > 0`;
    return new Map(rows.map((r) => [r.studentId, Number(r.due)]));
}

/** Open invoices (due > 0) of the given students, oldest first. */
async function openInvoices(db, { studentIds, invoiceIds } = {}) {
    const rows = await db.$queryRaw`
        WITH paid AS (${PAID_SQL})
        SELECT i.id, e."studentId" AS "studentId", i.month, h.name AS head, h.type::text AS type, h."order" AS "headOrder",
               GREATEST(i.amount - i.discount - COALESCE(paid.amount, 0), 0)::int AS due
        FROM "Invoice" i
        JOIN "Enrollment" e ON e.id = i."enrollmentId"
        JOIN "FeeHead" h ON h.id = i."feeHeadId"
        LEFT JOIN paid ON paid."invoiceId" = i.id
        WHERE GREATEST(i.amount - i.discount - COALESCE(paid.amount, 0), 0) > 0
          ${studentIds ? Prisma.sql`AND e."studentId" IN (${Prisma.join(studentIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty}
          ${invoiceIds ? Prisma.sql`AND i.id IN (${Prisma.join(invoiceIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty}
        ORDER BY i.month ASC, h."order" ASC`;
    return rows.map((r) => ({ id: r.id, studentId: r.studentId, month: r.month, head: r.head, type: r.type, due: Number(r.due), period: r.type === "MONTHLY" ? monthLabel(r.month) : "One time" }));
}

/* ------------------------------ access ------------------------------ */

/** Guardian: own child only (404 otherwise). Staff: fees.view. Returns the student profile. */
async function studentFor(user, studentId) {
    if (user.role === ROLE_KEYS.STUDENT) {
        if (user.studentId !== studentId) throw notFound();
    } else if (!can(user, "fees.view")) throw forbidden();
    const s = await getStudent(studentId, user.role === ROLE_KEYS.STUDENT ? user : null);
    if (!s) throw notFound();
    return s;
}

/* ------------------------------ ledger ------------------------------ */

const statusOf = (due, paid) => (due === 0 ? "PAID" : paid > 0 ? "PARTIAL" : "DUE");

/** Invoices + payments + totals of one student, all sessions. */
export async function studentLedger(studentId, user) {
    const s = await studentFor(user, studentId);
    const [invoices, payments] = await Promise.all([
        prisma.invoice.findMany({
            where: { enrollment: { studentId } },
            include: { feeHead: true, allocations: { include: { payment: { select: { reversal: { select: { id: true } } } } } } },
            orderBy: [{ month: "asc" }],
        }),
        prisma.payment.findMany({
            where: { studentId },
            include: { reversal: true, allocations: { include: { invoice: { include: { feeHead: true } } } } },
            orderBy: { paidAt: "desc" },
        }),
    ]);
    const inv = invoices
        .sort((a, b) => a.month.localeCompare(b.month) || a.feeHead.order - b.feeHead.order)
        .map((i) => {
            const paid = i.allocations.filter((a) => !a.payment.reversal).reduce((n, a) => n + a.amount, 0);
            const due = Math.max(0, i.amount - i.discount - paid);
            return { id: i.id, head: i.feeHead.name, month: i.month, period: i.feeHead.type === "MONTHLY" ? monthLabel(i.month) : "One time", amount: i.amount, discount: i.discount, discountNote: i.discountNote, paid, due, status: statusOf(due, paid) };
        });
    const pays = payments.map((p) => ({
        id: p.id,
        receiptNo: p.receiptNo,
        paidAt: p.paidAt.toISOString(),
        amount: p.amount,
        method: p.method,
        channel: p.channel,
        status: p.reversal ? "REVERSED" : "VALID",
        tranId: p.tranId,
        heads: p.allocations.map((a) => `${a.invoice.feeHead.name} · ${a.invoice.feeHead.type === "MONTHLY" ? monthLabel(a.invoice.month) : "One time"}`),
    }));
    return {
        student: { id: s.id, name: s.name, studentUid: s.studentUid, section: s.section, roll: s.roll, guardianPhone: s.guardianPhone },
        invoices: inv,
        payments: pays,
        totals: {
            billed: inv.reduce((n, i) => n + i.amount - i.discount, 0),
            paid: pays.filter((p) => p.status === "VALID").reduce((n, p) => n + p.amount, 0),
            due: inv.reduce((n, i) => n + i.due, 0),
            discount: inv.reduce((n, i) => n + i.discount, 0),
        },
    };
}

/* ------------------------------ lists ------------------------------ */

export async function dueList() {
    const [students, open] = await Promise.all([listStudents({}), openInvoices(prisma)]);
    const byStudent = new Map();
    for (const i of open) {
        const r = byStudent.get(i.studentId) ?? { months: new Set(), due: 0 };
        r.due += i.due;
        if (i.type === "MONTHLY") r.months.add(i.month);
        byStudent.set(i.studentId, r);
    }
    return students
        .filter((s) => byStudent.has(s.id))
        .map((s) => ({ studentId: s.id, studentUid: s.studentUid, name: s.name, classId: s.classId, classOrder: s.classOrder, section: s.section, roll: s.roll, guardianPhone: s.guardianPhone, monthsDue: byStudent.get(s.id).months.size, due: byStudent.get(s.id).due }))
        .sort((a, b) => b.due - a.due);
}

/** Counter screen: every active student with their open invoices (oldest first). */
export async function collectList() {
    const [students, open] = await Promise.all([listStudents({}), openInvoices(prisma)]);
    const byStudent = new Map();
    for (const i of open) {
        if (!byStudent.has(i.studentId)) byStudent.set(i.studentId, []);
        byStudent.get(i.studentId).push({ id: i.id, head: i.head, period: i.period, month: i.month, due: i.due });
    }
    return students
        .map((s) => {
            const dues = byStudent.get(s.id) ?? [];
            return { id: s.id, name: s.name, studentUid: s.studentUid, section: s.section, roll: s.roll, dues, due: dues.reduce((n, d) => n + d.due, 0) };
        })
        .sort((a, b) => b.due - a.due);
}

const paymentRow = (p) => {
    const en = p.student.enrollments[0];
    return {
        id: p.id,
        receiptNo: p.receiptNo,
        paidAt: p.paidAt.toISOString(),
        amount: p.amount,
        method: p.method,
        channel: p.channel,
        status: p.reversal ? "REVERSED" : "VALID",
        studentId: p.studentId,
        name: p.student.name,
        section: en ? sectionLabel(en.section) : "—",
        roll: en?.roll ?? null,
        tranId: p.tranId,
    };
};

export async function listPayments({ limit = 400, from, to } = {}) {
    const session = await getCurrentSession();
    const rows = await prisma.payment.findMany({
        where: { ...((from || to) && { paidOn: { ...(from && { gte: toDbDate(from) }), ...(to && { lte: toDbDate(to) }) } }) },
        orderBy: { paidAt: "desc" },
        take: limit,
        include: {
            reversal: { select: { id: true } },
            student: { select: { name: true, enrollments: { where: { sessionId: session.id }, include: { section: { include: { class: { select: { name: true } } } } } } } },
        },
    });
    return rows.map(paymentRow);
}

export async function getReceipt(paymentId, user) {
    const p = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { reversal: true, collectedBy: { select: { name: true } }, allocations: { include: { invoice: { include: { feeHead: true } } } } },
    });
    // Guardians: another student's receipt is a 404 (ids cannot be probed).
    if (!p || (user.role === ROLE_KEYS.STUDENT && p.studentId !== user.studentId)) throw notFound();
    if (user.role !== ROLE_KEYS.STUDENT && !can(user, "fees.view") && !can(user, "fees.collect")) throw forbidden();
    const s = await getStudent(p.studentId, null);
    return {
        payment: {
            id: p.id,
            receiptNo: p.receiptNo,
            paidAt: p.paidAt.toISOString(),
            amount: p.amount,
            method: p.method,
            channel: p.channel,
            status: p.reversal ? "REVERSED" : "VALID",
            reversalReason: p.reversal?.reason ?? null,
            reversedAt: p.reversal?.reversedAt.toISOString() ?? null,
            tranId: p.tranId,
            note: p.note,
            studentId: p.studentId,
        },
        student: { id: s.id, name: s.name, studentUid: s.studentUid, section: s.section, roll: s.roll, guardianPhone: s.guardianPhone },
        lines: p.allocations
            .sort((a, b) => a.invoice.month.localeCompare(b.invoice.month) || a.invoice.feeHead.order - b.invoice.feeHead.order)
            .map((a) => ({ head: a.invoice.feeHead.name, period: a.invoice.feeHead.type === "MONTHLY" ? monthLabel(a.invoice.month) : "One time", amount: a.amount })),
        advance: p.amount - p.allocations.reduce((n, a) => n + a.amount, 0),
        collectedBy: p.channel === "ONLINE" ? "Online (gateway)" : (p.collectedBy?.name ?? "Office"),
    };
}

/* ------------------------------ summary + structure ------------------------------ */

export async function feeSummary() {
    const session = await getCurrentSession();
    const today = dhakaDateString();
    const month = dhakaMonthString();
    const start = fromDbDate(session.startDate).slice(0, 7);
    const valid = { reversal: { is: null } };
    const [todayAgg, monthAgg, byMethod, byMonthRows, dues] = await Promise.all([
        prisma.payment.aggregate({ where: { ...valid, paidOn: toDbDate(today) }, _sum: { amount: true }, _count: { _all: true } }),
        prisma.payment.aggregate({ where: { ...valid, paidOn: { gte: toDbDate(`${month}-01`), lte: toDbDate(today) } }, _sum: { amount: true } }),
        prisma.payment.groupBy({ by: ["method"], where: { ...valid, paidOn: { gte: toDbDate(`${month}-01`), lte: toDbDate(today) } }, _sum: { amount: true } }),
        prisma.$queryRaw`
            SELECT to_char(p."paidOn", 'YYYY-MM') AS ym, SUM(p.amount)::int AS amount
            FROM "Payment" p LEFT JOIN "PaymentReversal" r ON r."paymentId" = p.id
            WHERE r.id IS NULL AND p."paidOn" >= ${toDbDate(`${start}-01`)} AND p."paidOn" <= ${toDbDate(today)}
            GROUP BY 1`,
        studentsWithDues(),
    ]);
    const perMonth = new Map(byMonthRows.map((r) => [r.ym, Number(r.amount)]));
    const byMonth = [];
    for (let ym = start; ym <= month && byMonth.length < 12; ) {
        byMonth.push({ label: MONTH_NAMES[Number(ym.slice(5)) - 1], value: perMonth.get(ym) ?? 0 });
        const [y, m] = ym.split("-").map(Number);
        ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
    const methodMap = new Map(byMethod.map((r) => [r.method, r._sum.amount ?? 0]));
    const methods = ["CASH", "BKASH", "CARD", "BANK", "NAGAD", "ROCKET"].filter((m) => m === "CASH" || methodMap.get(m)).map((m) => ({ label: METHOD_LABEL[m], value: methodMap.get(m) ?? 0 }));
    return {
        today: todayAgg._sum.amount ?? 0,
        todayCount: todayAgg._count._all,
        thisMonth: monthAgg._sum.amount ?? 0,
        totalDue: [...dues.values()].reduce((a, b) => a + b, 0),
        defaulters: dues.size,
        byMonth,
        methods,
    };
}

/** Class × head amounts for the current session (0 = not charged). */
export async function feeStructure() {
    const session = await getCurrentSession();
    const [classes, heads, rows] = await Promise.all([
        prisma.class.findMany({ where: { isActive: true }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
        prisma.feeHead.findMany({ where: { isActive: true }, orderBy: { order: "asc" } }),
        prisma.feeStructure.findMany({ where: { sessionId: session.id } }),
    ]);
    const amount = new Map(rows.map((r) => [`${r.classId}|${r.feeHeadId}`, r.amount]));
    return classes.map((c) => ({ classId: c.id, className: c.name, heads: heads.map((h) => ({ feeHeadId: h.id, head: h.name, type: h.type, amount: amount.get(`${c.id}|${h.id}`) ?? 0 })) }));
}

/** Upserts amounts. Existing invoices keep their copied amount (only new invoices use the new fee). */
export async function updateStructure({ items }, ctx) {
    const session = await getCurrentSession();
    await tx(async (t) => {
        for (const it of items) {
            await t.feeStructure.upsert({
                where: { sessionId_classId_feeHeadId: { sessionId: session.id, classId: it.classId, feeHeadId: it.feeHeadId } },
                create: { sessionId: session.id, classId: it.classId, feeHeadId: it.feeHeadId, amount: it.amount },
                update: { amount: it.amount },
            });
        }
        await audit(ctx, { action: "fees.structure", entity: "FeeStructure", entityId: session.id, after: { detail: `Updated ${items.length} fee amount${items.length > 1 ? "s" : ""} for session ${session.name}` } }, t);
    });
    return feeStructure();
}

/* ------------------------------ invoices ------------------------------ */

/**
 * Creates invoices for a month. Default heads: every active MONTHLY head; ONE_TIME heads only when
 * listed. Idempotent: (enrollment, head, month) is unique, existing invoices are skipped.
 * Standing concessions become the invoice discount (percent rounds down; never above the amount).
 */
export async function generateInvoices({ month, feeHeadIds, classIds, dueDate }, ctx) {
    const session = await getCurrentSession();
    const start = fromDbDate(session.startDate).slice(0, 7);
    const end = fromDbDate(session.endDate).slice(0, 7);
    if (month < start || month > end) throw badRequest(`${monthLabel(month)} is outside session ${session.name}.`);
    const heads = await prisma.feeHead.findMany({ where: { isActive: true, ...(feeHeadIds ? { id: { in: feeHeadIds } } : { type: "MONTHLY" }) } });
    if (!heads.length) throw badRequest("No fee head selected.");
    const [structure, enrollments, concessions] = await Promise.all([
        prisma.feeStructure.findMany({ where: { sessionId: session.id, feeHeadId: { in: heads.map((h) => h.id) } } }),
        prisma.enrollment.findMany({ where: { sessionId: session.id, student: { status: "ACTIVE" }, ...(classIds && { section: { classId: { in: classIds } } }) }, select: { id: true, studentId: true, section: { select: { classId: true } } } }),
        prisma.studentConcession.findMany({ where: { sessionId: session.id, feeHeadId: { in: heads.map((h) => h.id) } } }),
    ]);
    const fee = new Map(structure.map((s) => [`${s.classId}|${s.feeHeadId}`, s.amount]));
    const waiver = new Map(concessions.map((c) => [`${c.studentId}|${c.feeHeadId}`, c]));
    const data = [];
    for (const e of enrollments) {
        for (const h of heads) {
            const amount = fee.get(`${e.section.classId}|${h.id}`) ?? 0;
            if (amount <= 0) continue;
            const c = waiver.get(`${e.studentId}|${h.id}`);
            const discount = c ? Math.min(amount, c.percent != null ? Math.floor((amount * c.percent) / 100) : (c.amount ?? 0)) : 0;
            data.push({ enrollmentId: e.id, feeHeadId: h.id, month, amount, discount, discountNote: discount ? c.reason : null, dueDate: dueDate ? toDbDate(dueDate) : null });
        }
    }
    const created = data.length ? (await prisma.invoice.createMany({ data, skipDuplicates: true })).count : 0;
    if (created) await audit(ctx, { action: "fees.invoices", entity: "Invoice", entityId: month, after: { detail: `Generated ${created} invoices for ${monthLabel(month)} (${heads.map((h) => h.name).join(", ")})` } });
    return { month, created, skipped: data.length - created };
}

/* ------------------------------ payments ------------------------------ */

async function receiptNo(t, at) {
    const year = dhakaDateString(at).slice(0, 4);
    const n = await nextCounter(t, `receipt:${year}`);
    const prefix = (await receiptPrefixSetting()) ?? (await studentUidPrefix()).replace(/-+$/, "");
    return `${prefix}-${year}-${String(n).padStart(5, "0")}`;
}

/**
 * Locks the invoices, re-reads their dues and allocates `amount` oldest first.
 * @returns {Promise<{ lines: { invoiceId: string, amount: number }[], due: number }>}
 */
async function allocate(t, studentId, invoiceIds, amount) {
    if (!invoiceIds.length) return { lines: [], due: 0 };
    await t.$queryRaw`SELECT id FROM "Invoice" WHERE id IN (${Prisma.join(invoiceIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
    const open = await openInvoices(t, { invoiceIds });
    if (open.some((i) => i.studentId !== studentId)) throw badRequest("Some invoices belong to another student.");
    const due = open.reduce((n, i) => n + i.due, 0);
    let left = amount;
    const lines = [];
    for (const i of open) {
        if (left <= 0) break;
        const a = Math.min(left, i.due);
        lines.push({ invoiceId: i.id, amount: a });
        left -= a;
    }
    return { lines, due };
}

/** Double-submit guard: the same clientRef is accepted once (10 min). Fails open without Redis. */
async function claimClientRef(ref) {
    if (!ref) return true;
    try {
        return (await redis().set(`${env.QUEUE_PREFIX}:payref:${ref}`, "1", "EX", 600, "NX")) === "OK";
    } catch (err) {
        logger.warn({ err: err.message }, "payment clientRef check skipped (redis)");
        return true;
    }
}

/** Counter payment. Amount must not exceed the selected dues (no silent advance at the counter). */
export async function collect({ studentId, amount, method, invoiceIds, note, clientRef }, user, ctx) {
    if (!(await claimClientRef(clientRef))) throw conflict("This payment was already submitted. Check the payments list before collecting again.");
    const s = await getStudent(studentId, null);
    if (!s) throw notFound();
    const paidAt = new Date();
    const id = await tx(async (t) => {
        const { lines, due } = await allocate(t, studentId, [...new Set(invoiceIds)], amount);
        if (!due) throw conflict("These dues are already paid. Reload the student.");
        if (amount > due) throw badRequest(`The amount is more than the selected dues (৳ ${due}).`, [{ path: "amount", message: `Maximum ৳ ${due}` }]);
        const p = await t.payment.create({
            data: { receiptNo: await receiptNo(t, paidAt), studentId, amount, method, channel: "COUNTER", collectedById: user.id, paidAt, paidOn: toDbDate(dhakaDateString(paidAt)), note: note || null, allocations: { create: lines } },
        });
        await audit(ctx, { action: "fees.payment", entity: "Payment", entityId: p.id, after: { receiptNo: p.receiptNo, amount, method, detail: `Collected ৳ ${amount} (${METHOD_LABEL[method]}) from ${s.name}, receipt ${p.receiptNo}` } }, t);
        return p.id;
    });
    return getReceipt(id, user);
}

export async function reversePayment(paymentId, { reason }, user, ctx) {
    const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { reversal: true, student: { select: { name: true } } } });
    if (!p) throw notFound();
    if (p.reversal) throw conflict("This payment is already reversed.");
    const at = new Date();
    try {
        await tx(async (t) => {
            await t.paymentReversal.create({ data: { paymentId, reason, reversedById: user.id, reversedAt: at, reversedOn: toDbDate(dhakaDateString(at)) } });
            await audit(ctx, { action: "fees.reverse", entity: "Payment", entityId: paymentId, before: { status: "VALID" }, after: { status: "REVERSED", reason, detail: `Reversed receipt ${p.receiptNo} (৳ ${p.amount}, ${p.student.name}): ${reason}` } }, t);
        });
    } catch (err) {
        if (err?.code === "P2002") throw conflict("This payment is already reversed.");
        throw err;
    }
    return getReceipt(paymentId, user);
}

/* ------------------------------ online (used by fees.gateway.js) ------------------------------ */

export { allocate, openInvoices, receiptNo, METHOD_LABEL };

/* ------------------------------ concessions (Step 5) ------------------------------ */

/** Standing waivers of a student in the current session. */
export async function listConcessions(studentId) {
    const session = await getCurrentSession();
    const [rows, heads] = await Promise.all([
        prisma.studentConcession.findMany({ where: { studentId, sessionId: session.id }, include: { feeHead: true }, orderBy: { createdAt: "asc" } }),
        prisma.feeHead.findMany({ where: { isActive: true }, orderBy: { order: "asc" }, select: { id: true, name: true, type: true } }),
    ]);
    return {
        session: session.name,
        items: rows.map((c) => ({ id: c.id, feeHeadId: c.feeHeadId, head: c.feeHead.name, percent: c.percent, amount: c.amount, reason: c.reason })),
        heads: heads.map((h) => ({ value: h.id, label: h.name, type: h.type })),
    };
}

/**
 * Creates or replaces the waiver for one head. Applies to invoices generated from now on; invoices
 * already issued keep their discount (they may be partly paid). Audited.
 */
export async function setConcession(studentId, { feeHeadId, percent, amount, reason }, ctx) {
    const session = await getCurrentSession();
    const s = await getStudent(studentId, null);
    const head = await prisma.feeHead.findUnique({ where: { id: feeHeadId } });
    if (!head) throw badRequest("Choose a fee.", [{ path: "feeHeadId", message: "Choose a fee." }]);
    await tx(async (t) => {
        const c = await t.studentConcession.upsert({
            where: { studentId_sessionId_feeHeadId: { studentId, sessionId: session.id, feeHeadId } },
            create: { studentId, sessionId: session.id, feeHeadId, percent: percent ?? null, amount: amount ?? null, reason, createdById: ctx.actorId },
            update: { percent: percent ?? null, amount: amount ?? null, reason },
        });
        await audit(ctx, { action: "fees.concession", entity: "StudentConcession", entityId: c.id, after: { detail: `Waiver for ${s.name}: ${head.name} ${percent != null ? `${percent}%` : `৳ ${amount}`} (${reason})` } }, t);
    });
    return listConcessions(studentId);
}

export async function removeConcession(id, ctx) {
    const c = await prisma.studentConcession.findUnique({ where: { id }, include: { feeHead: true, student: { select: { name: true } } } });
    if (!c) throw notFound();
    await tx(async (t) => {
        await t.studentConcession.delete({ where: { id } });
        await audit(ctx, { action: "fees.concession_delete", entity: "StudentConcession", entityId: id, before: { percent: c.percent, amount: c.amount, reason: c.reason }, after: { detail: `Removed waiver for ${c.student.name}: ${c.feeHead.name}` } }, t);
    });
    return listConcessions(c.studentId);
}

/** Worker: generate this month's invoices on the configured day (fees.autoInvoiceDay). Idempotent. */
export async function autoInvoices(day) {
    const today = dhakaDateString();
    if (!day || Number(today.slice(8, 10)) !== day) return { skipped: "not the invoice day" };
    return generateInvoices({ month: today.slice(0, 7) }, { actorId: null, ip: null, userAgent: "scheduler" });
}

/** Worker: checkouts nobody finished. A late IPN can still confirm an EXPIRED intent (money taken = recorded). */
export async function expireIntents() {
    const r = await prisma.paymentIntent.updateMany({ where: { status: "INITIATED", expiresAt: { lt: new Date(Date.now() - 60 * 60_000) } }, data: { status: "EXPIRED" } });
    return r.count;
}
