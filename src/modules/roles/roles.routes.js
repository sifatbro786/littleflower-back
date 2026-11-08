import { Router } from "express";

import { auditCtx } from "#core/audit.js";
import { ok } from "#core/http.js";
import { requirePermission } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import { createRoleSchema, roleIdParams, updateRoleSchema } from "./roles.schema.js";
import * as roles from "./roles.service.js";

export const rolesRouter = Router();
rolesRouter.use(requirePermission("users.manage"));

/** GET /api/roles → { data: RoleItem[] } (Student role excluded) */
rolesRouter.get("/", async (_req, res) => {
    ok(res, await roles.listRoles());
});

/** GET /api/roles/:id → { data: RoleItem } */
rolesRouter.get("/:id", validate({ params: roleIdParams }), async (req, res) => {
    ok(res, await roles.getRole(req.valid.params.id));
});

/** POST /api/roles { name, description?, permissions[] } → 201 { data: RoleItem } */
rolesRouter.post("/", validate({ body: createRoleSchema }), async (req, res) => {
    ok(res, await roles.createRole(req.valid.body, req.user, auditCtx(req)), { status: 201 });
});

/** PATCH /api/roles/:id { name?, description?, permissions? } → { data: RoleItem } */
rolesRouter.patch("/:id", validate({ params: roleIdParams, body: updateRoleSchema }), async (req, res) => {
    ok(res, await roles.updateRole(req.valid.params.id, req.valid.body, req.user, auditCtx(req)));
});

/** DELETE /api/roles/:id → { data: { deleted: true } } */
rolesRouter.delete("/:id", validate({ params: roleIdParams }), async (req, res) => {
    ok(res, await roles.deleteRole(req.valid.params.id, req.user, auditCtx(req)));
});
