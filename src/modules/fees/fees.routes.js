import express, { Router } from "express";

import { env } from "#config/env.js";
import { requireAuth } from "#core/auth.js";
import { auditCtx } from "#core/audit.js";
import { forbidden } from "#core/errors.js";
import { ok } from "#core/http.js";
import { logger } from "#core/logger.js";
import { rateLimit } from "#core/rate-limit.js";
import { can, requireAnyPermission, requirePermission, ROLE_KEYS } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import * as gw from "./fees.gateway.js";
import * as s from "./fees.schema.js";
import * as fees from "./fees.service.js";

/** /api/fees — staff fees screens; guardians read their own child's ledger and receipts (404 otherwise). */
export const feesRouter = Router();

const view = requirePermission("fees.view");
const ownOrFees = (req, _res, next) => (req.user.role === ROLE_KEYS.STUDENT || can(req.user, "fees.view") || can(req.user, "fees.collect") ? next() : next(forbidden()));

feesRouter.get("/summary", requireAnyPermission("fees.view", "fees.collect"), async (_req, res) => ok(res, await fees.feeSummary()));
feesRouter.get("/dues", view, async (_req, res) => ok(res, await fees.dueList()));
feesRouter.get("/collect-list", requirePermission("fees.collect"), async (_req, res) => ok(res, await fees.collectList()));
feesRouter.get("/structure", view, async (_req, res) => ok(res, await fees.feeStructure()));
feesRouter.put("/structure", requirePermission("fees.manage"), validate({ body: s.structureSchema }), async (req, res) => ok(res, await fees.updateStructure(req.valid.body, auditCtx(req))));
feesRouter.post("/invoices/generate", requirePermission("fees.manage"), validate({ body: s.generateSchema }), async (req, res) => ok(res, await fees.generateInvoices(req.valid.body, auditCtx(req))));
feesRouter.get("/students/:studentId/ledger", requireAuth, ownOrFees, validate({ params: s.studentParams }), async (req, res) => ok(res, await fees.studentLedger(req.valid.params.studentId, req.user)));

feesRouter.get("/students/:studentId/concessions", view, validate({ params: s.studentParams }), async (req, res) => ok(res, await fees.listConcessions(req.valid.params.studentId)));
feesRouter.put("/students/:studentId/concessions", requirePermission("fees.manage"), validate({ params: s.studentParams, body: s.concessionSchema }), async (req, res) =>
    ok(res, await fees.setConcession(req.valid.params.studentId, req.valid.body, auditCtx(req))),
);
feesRouter.delete("/concessions/:id", requirePermission("fees.manage"), validate({ params: s.idParams }), async (req, res) => ok(res, await fees.removeConcession(req.valid.params.id, auditCtx(req))));

feesRouter.get("/payments", view, validate({ query: s.paymentsQuery }), async (req, res) => ok(res, await fees.listPayments(req.valid.query)));
feesRouter.post("/payments", requirePermission("fees.collect"), validate({ body: s.collectSchema }), async (req, res) => ok(res, await fees.collect(req.valid.body, req.user, auditCtx(req)), { status: 201 }));
feesRouter.get("/payments/:id", requireAuth, ownOrFees, validate({ params: s.idParams }), async (req, res) => ok(res, await fees.getReceipt(req.valid.params.id, req.user)));
feesRouter.post("/payments/:id/reverse", requirePermission("fees.manage"), validate({ params: s.idParams, body: s.reverseSchema }), async (req, res) =>
    ok(res, await fees.reversePayment(req.valid.params.id, req.valid.body, req.user, auditCtx(req))),
);

/**
 * /api/payments — online checkout. /ipn, /success, /fail, /cancel are called by SSLCommerz (form-urlencoded,
 * no session; exempt from the JSON-only CSRF guard in app.js). They never trust the posted fields:
 * success is decided by the validation API inside gw.confirm().
 */
export const paymentsRouter = Router();
const form = express.urlencoded({ extended: false, limit: "64kb" });
// Gateway callbacks are public: cap per IP so they cannot be used to hammer the validation API.
paymentsRouter.use(["/ipn", "/success", "/fail", "/cancel"], rateLimit({ name: "pay:callback", limit: 60, windowSec: 60 }));
const portalUrl = (q) => `${env.APP_URL.replace(/\/+$/, "")}/portal/fees?payment=${q}`;

paymentsRouter.get("/available", requireAuth, (_req, res) => ok(res, { online: gw.gatewayConfigured() }));
paymentsRouter.post(
    "/session",
    requireAuth,
    (req, _res, next) => (req.user.role === ROLE_KEYS.STUDENT ? next() : next(forbidden("Online payment is for guardians. Use Collect fee at the counter."))),
    rateLimit({ name: "pay:session", limit: 6, windowSec: 600, key: (req) => req.user.id, message: "Too many payment attempts. Please wait a few minutes." }),
    async (req, res) => ok(res, await gw.createSession(req.user), { status: 201 }),
);

paymentsRouter.post("/ipn", form, async (req, res) => {
    try {
        const r = await gw.confirm({ tranId: req.body?.tran_id, valId: req.body?.val_id });
        res.status(200).send(r.status);
    } catch (err) {
        logger.error({ err: err.message, tranId: req.body?.tran_id }, "IPN handling failed");
        res.status(500).send("ERROR"); // SSLCommerz retries the IPN
    }
});
paymentsRouter.post("/success", form, async (req, res) => {
    let status = "processing";
    try {
        const r = await gw.confirm({ tranId: req.body?.tran_id, valId: req.body?.val_id });
        if (r.status === "PAID") status = "success";
        if (r.status === "FAILED") status = "failed";
    } catch (err) {
        logger.error({ err: err.message }, "payment success redirect: confirm failed");
    }
    res.redirect(303, portalUrl(status));
});
paymentsRouter.post("/fail", form, async (req, res) => {
    await gw.abandon(req.body?.tran_id, "FAILED").catch(() => {});
    res.redirect(303, portalUrl("failed"));
});
paymentsRouter.post("/cancel", form, async (req, res) => {
    await gw.abandon(req.body?.tran_id, "CANCELLED").catch(() => {});
    res.redirect(303, portalUrl("cancelled"));
});
