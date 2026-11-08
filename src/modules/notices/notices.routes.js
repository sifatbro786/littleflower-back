import { Router } from "express";

import { requireAuth } from "#core/auth.js";
import { auditCtx } from "#core/audit.js";
import { forbidden, notFound } from "#core/errors.js";
import { ok } from "#core/http.js";
import { requirePermission, requireStaffUser, ROLE_KEYS } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import { createNoticeSchema, idParams, listQuery, updateNoticeSchema } from "./notices.schema.js";
import * as notices from "./notices.service.js";

/** /api/notices — staff list (any staff), portal list (guardian), writes need notices.manage. */
export const noticesRouter = Router();
const manage = requirePermission("notices.manage");

noticesRouter.get("/", requireStaffUser, validate({ query: listQuery }), async (req, res) => ok(res, await notices.listStaffNotices(req.valid.query, req.user)));
noticesRouter.get("/portal", requireAuth, async (req, res) => {
    if (req.user.role !== ROLE_KEYS.STUDENT) throw forbidden();
    if (!req.user.studentId) throw notFound();
    ok(res, await notices.portalNotices(req.user.studentId));
});
noticesRouter.post("/", manage, validate({ body: createNoticeSchema }), async (req, res) => ok(res, await notices.createNotice(req.valid.body, auditCtx(req)), { status: 201 }));
noticesRouter.patch("/:id", manage, validate({ params: idParams, body: updateNoticeSchema }), async (req, res) => ok(res, await notices.updateNotice(req.valid.params.id, req.valid.body, auditCtx(req))));
noticesRouter.delete("/:id", manage, validate({ params: idParams }), async (req, res) => ok(res, await notices.deleteNotice(req.valid.params.id, auditCtx(req))));
