import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "#core/auth.js";
import { auditCtx } from "#core/audit.js";
import { forbidden } from "#core/errors.js";
import { ok } from "#core/http.js";
import { can, requirePermission, ROLE_KEYS } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import { routineQuery, slotSchema, todayQuery } from "./routine.schema.js";
import * as routine from "./routine.service.js";

/** /api/routine — routine.view for staff; a guardian may read their child's section routine. */
export const routineRouter = Router();

const viewOrSelf = [requireAuth, (req, _res, next) => (req.user.role === ROLE_KEYS.STUDENT || can(req.user, "routine.view") ? next() : next(forbidden()))];

routineRouter.get("/", ...viewOrSelf, validate({ query: routineQuery }), async (req, res) => ok(res, await routine.getRoutine(req.valid.query, req.user)));
routineRouter.get("/today", requirePermission("routine.view"), validate({ query: todayQuery }), async (req, res) => ok(res, await routine.teacherToday(req.valid.query.staffId, req.valid.query.date)));
routineRouter.get("/options", requirePermission("routine.manage"), validate({ query: z.object({ sectionId: z.uuid() }) }), async (req, res) => ok(res, await routine.editorOptions(req.valid.query.sectionId)));
routineRouter.put("/slot", requirePermission("routine.manage"), validate({ body: slotSchema }), async (req, res) => ok(res, await routine.setSlot(req.valid.body, auditCtx(req))));
