import { Router } from "express";

import { auditCtx } from "#core/audit.js";
import { ok } from "#core/http.js";
import { requirePermission } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import { patchSchema } from "./settings.schema.js";
import * as settings from "./settings.service.js";

/** /api/settings — school settings screen (settings.manage). */
export const settingsRouter = Router();

settingsRouter.get("/", requirePermission("settings.manage"), async (_req, res) => ok(res, await settings.getAllSettings()));
settingsRouter.patch("/", requirePermission("settings.manage"), validate({ body: patchSchema }), async (req, res) => ok(res, await settings.updateSettings(req.valid.body, auditCtx(req))));
