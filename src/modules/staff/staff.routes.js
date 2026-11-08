import { Router } from "express";
import { z } from "zod";

import { auditCtx } from "#core/audit.js";
import { ok } from "#core/http.js";
import { requirePermission } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import { createStaffSchema, idParams, updateStaffSchema } from "./staff.schema.js";
import * as staff from "./staff.service.js";

/** /api/staff — teachers & office staff (academics.manage). */
export const staffRouter = Router();
staffRouter.use(requirePermission("academics.manage"));

const listQuery = z.object({ all: z.enum(["0", "1"]).optional() });

staffRouter.get("/", validate({ query: listQuery }), async (req, res) => ok(res, await staff.listStaff({ includeInactive: req.valid.query.all === "1" })));
staffRouter.get("/:id", validate({ params: idParams }), async (req, res) => ok(res, await staff.getStaff(req.valid.params.id)));
staffRouter.post("/", validate({ body: createStaffSchema }), async (req, res) => ok(res, await staff.createStaff(req.valid.body, auditCtx(req)), { status: 201 }));
staffRouter.patch("/:id", validate({ params: idParams, body: updateStaffSchema }), async (req, res) => ok(res, await staff.updateStaff(req.valid.params.id, req.valid.body, auditCtx(req))));
staffRouter.delete("/:id", validate({ params: idParams }), async (req, res) => ok(res, await staff.deleteStaff(req.valid.params.id, auditCtx(req))));
