import { Router } from "express";

import { auditCtx } from "#core/audit.js";
import { ok } from "#core/http.js";
import { rateLimit } from "#core/rate-limit.js";
import { requireAnyPermission, requirePermission } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import { sendSchema, templateParams, templateSchema } from "./sms.schema.js";
import * as sms from "./sms.service.js";

/** /api/sms — sms.send (anything) or sms.dues (fee reminders only, checked in the service). */
export const smsRouter = Router();
smsRouter.use(requireAnyPermission("sms.send", "sms.dues"));

smsRouter.get("/overview", async (_req, res) => ok(res, await sms.overview()));
smsRouter.post("/send", rateLimit({ name: "sms:user", limit: 10, windowSec: 600, key: (req) => req.user.id, message: "Too many bulk sends. Please wait a few minutes." }), validate({ body: sendSchema }), async (req, res) => ok(res, await sms.send(req.valid.body, req.user, auditCtx(req))));
smsRouter.patch("/templates/:id", requirePermission("sms.send"), validate({ params: templateParams, body: templateSchema }), async (req, res) => ok(res, await sms.updateTemplate(req.valid.params.id, req.valid.body, auditCtx(req))));
