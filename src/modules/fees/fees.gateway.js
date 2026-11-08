import { randomBytes } from "node:crypto";

import { env } from "#config/env.js";
import { audit } from "#core/audit.js";
import { AppError, conflict, notFound } from "#core/errors.js";
import { dhakaDateString, toDbDate } from "#core/dates.js";
import { logger } from "#core/logger.js";
import { prisma, tx } from "#core/prisma.js";

import { schoolName } from "#modules/settings/settings.service.js";
import { getStudent } from "#modules/students/students.service.js";

import { allocate, openInvoices, receiptNo } from "./fees.service.js";

/**
 * SSLCommerz online payment (PRD §10.3).
 * 1. POST /api/payments/session (guardian) → PaymentIntent INITIATED + gateway session → redirect URL.
 * 2. Gateway → POST /api/payments/ipn (server to server) and the browser → /success|/fail|/cancel.
 * 3. A payment is created ONLY after the validation API confirms val_id (status VALID/VALIDATED,
 *    same tran_id, same amount, BDT). Browser parameters are never trusted. /success runs the same
 *    validation (so local dev without a public IPN URL still works); whichever arrives first wins and
 *    the other is a no-op: the intent row is locked FOR UPDATE and Payment.tranId is unique.
 * 4. The money is allocated to the intent's invoices that are still due at confirmation time; anything
 *    left (paid at the counter meanwhile) stays on the payment as advance credit (sum(allocations) <= amount).
 */

const INTENT_TTL_MIN = 30;
const base = () => (env.SSLC_SANDBOX ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com");
export const gatewayConfigured = () => Boolean(env.SSLC_STORE_ID && env.SSLC_STORE_PASS);

const newTranId = () => `GD${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;

/** Guardian starts a checkout for all current dues of their child. */
export async function createSession(user) {
    if (!gatewayConfigured()) throw new AppError(503, "GATEWAY_OFF", "Online payment is not available yet. Please pay at the school office.");
    const studentId = user.studentId;
    if (!studentId) throw notFound();
    const open = await openInvoices(prisma, { studentIds: [studentId] });
    const amount = open.reduce((n, i) => n + i.due, 0);
    if (!amount) throw conflict("Nothing is due right now.");
    const s = await getStudent(studentId, user);
    const tranId = newTranId();
    const intent = await prisma.paymentIntent.create({
        data: { tranId, studentId, amount, invoiceIds: open.map((i) => i.id), initiatedById: user.id, expiresAt: new Date(Date.now() + INTENT_TTL_MIN * 60_000) },
    });
    const back = `${env.APP_URL.replace(/\/+$/, "")}/api/payments`;
    const form = new URLSearchParams({
        store_id: env.SSLC_STORE_ID,
        store_passwd: env.SSLC_STORE_PASS,
        total_amount: String(amount),
        currency: "BDT",
        tran_id: tranId,
        success_url: `${back}/success`,
        fail_url: `${back}/fail`,
        cancel_url: `${back}/cancel`,
        ipn_url: `${back}/ipn`,
        cus_name: s.guardianName || s.name,
        cus_email: s.guardianEmail || "guardian@example.com",
        cus_phone: s.guardianPhone,
        cus_add1: s.address || "Dhaka",
        cus_city: "Dhaka",
        cus_country: "Bangladesh",
        shipping_method: "NO",
        num_of_item: String(open.length),
        product_name: `${await schoolName()} fees (${s.studentUid})`,
        product_category: "Education",
        product_profile: "non-physical-goods",
        value_a: intent.id,
    });
    let json;
    try {
        const res = await fetch(`${base()}/gwprocess/v4/api.php`, { method: "POST", body: form, signal: AbortSignal.timeout(15_000) });
        json = await res.json();
    } catch (err) {
        logger.error({ err: err.message, tranId }, "SSLCommerz session failed");
    }
    if (json?.status !== "SUCCESS" || !json.GatewayPageURL) {
        await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "FAILED", gatewayPayload: json ?? undefined } });
        throw new AppError(502, "GATEWAY_ERROR", "The payment gateway is not responding. Please try again in a few minutes.");
    }
    return { tranId, amount, redirectUrl: json.GatewayPageURL };
}

const methodOf = (v) => {
    const s = `${v.card_type ?? ""} ${v.card_issuer ?? ""} ${v.card_brand ?? ""}`;
    if (/bkash/i.test(s)) return "BKASH";
    if (/nagad/i.test(s)) return "NAGAD";
    if (/rocket|dbbl\s*mobile/i.test(s)) return "ROCKET";
    return "CARD";
};

async function validate(valId) {
    const q = new URLSearchParams({ val_id: valId, store_id: env.SSLC_STORE_ID, store_passwd: env.SSLC_STORE_PASS, v: "1", format: "json" });
    const res = await fetch(`${base()}/validator/api/validationserverAPI.php?${q}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`validation API HTTP ${res.status}`);
    return res.json();
}

/**
 * Confirms a gateway transaction through the validation API and records the payment once.
 * @returns {Promise<{ status: "PAID" | "FAILED" | "PENDING" | "UNKNOWN", paymentId?: string }>}
 */
export async function confirm({ tranId, valId }) {
    if (!gatewayConfigured() || !tranId) return { status: "UNKNOWN" };
    const intent = await prisma.paymentIntent.findUnique({ where: { tranId } });
    if (!intent) return { status: "UNKNOWN" };
    if (intent.status === "PAID") return { status: "PAID", paymentId: intent.paymentId };
    if (!valId) return { status: "PENDING" };

    let v;
    try {
        v = await validate(valId);
    } catch (err) {
        logger.error({ err: err.message, tranId }, "SSLCommerz validation failed; the IPN retry will confirm later");
        return { status: "PENDING" };
    }
    const okStatus = v.status === "VALID" || v.status === "VALIDATED";
    const amountOk = Math.round(Number(v.amount)) === intent.amount && (v.currency_type ?? v.currency ?? "BDT") === "BDT";
    if (!okStatus || v.tran_id !== tranId || !amountOk) {
        logger.warn({ tranId, status: v.status, amount: v.amount, expected: intent.amount }, "gateway transaction rejected");
        await prisma.paymentIntent.updateMany({ where: { id: intent.id, status: "INITIATED" }, data: { status: "FAILED", valId, gatewayPayload: v } });
        return { status: "FAILED" };
    }

    const paidAt = v.tran_date ? new Date(`${v.tran_date.replace(" ", "T")}+06:00`) : new Date();
    const at = Number.isNaN(paidAt.getTime()) ? new Date() : paidAt;
    const paymentId = await tx(async (t) => {
        const [row] = await t.$queryRaw`SELECT status, "paymentId" FROM "PaymentIntent" WHERE id = ${intent.id}::uuid FOR UPDATE`;
        if (row.status === "PAID") return row.paymentId;
        const { lines } = await allocate(t, intent.studentId, intent.invoiceIds, intent.amount);
        const p = await t.payment.create({
            data: {
                receiptNo: await receiptNo(t, at),
                studentId: intent.studentId,
                amount: intent.amount,
                method: methodOf(v),
                channel: "ONLINE",
                tranId,
                paidAt: at,
                paidOn: toDbDate(dhakaDateString(at)),
                note: v.bank_tran_id ? `Bank tran ${v.bank_tran_id}` : null,
                allocations: { create: lines },
            },
        });
        await t.paymentIntent.update({ where: { id: intent.id }, data: { status: "PAID", valId, gatewayPayload: v, paymentId: p.id } });
        await audit({ actorId: null, ip: null, userAgent: "sslcommerz" }, { action: "fees.online_payment", entity: "Payment", entityId: p.id, after: { receiptNo: p.receiptNo, tranId, amount: intent.amount, detail: `Online payment ৳ ${intent.amount}, receipt ${p.receiptNo} (${tranId})` } }, t);
        return p.id;
    });
    return { status: "PAID", paymentId };
}

/** Browser came back with fail/cancel. Only an INITIATED intent changes; a paid one never does. */
export async function abandon(tranId, status) {
    if (!tranId) return;
    await prisma.paymentIntent.updateMany({ where: { tranId, status: "INITIATED" }, data: { status } });
}
