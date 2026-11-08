import { Router } from "express";

import { auditCtx } from "#core/audit.js";
import { ok } from "#core/http.js";
import { requirePermission } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import { createUserSchema, idParams, listUsersQuery, updateUserSchema } from "./users.schema.js";
import { listUnlinkedStaff } from "#modules/staff/staff.service.js";

import * as users from "./users.service.js";

export const usersRouter = Router();
usersRouter.use(requirePermission("users.manage"));

/** GET /api/users?q=&roleId=&status= → { data: UserRow[] } */
usersRouter.get("/", validate({ query: listUsersQuery }), async (req, res) => {
    ok(res, await users.listUsers(req.valid.query));
});

/** GET /api/users/staff-options → staff records without a login (to link on create) */
usersRouter.get("/staff-options", async (_req, res) => {
    ok(res, await listUnlinkedStaff());
});

/** GET /api/users/:id → { data: UserDetail } */
usersRouter.get("/:id", validate({ params: idParams }), async (req, res) => {
    ok(res, await users.getUser(req.valid.params.id));
});

/** POST /api/users → 201 { data: { user, tempPassword? } }  (tempPassword only when the API generated it) */
usersRouter.post("/", validate({ body: createUserSchema }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    ok(res, await users.createUser(req.valid.body, req.user, auditCtx(req)), { status: 201 });
});

/** PATCH /api/users/:id { name?, email?, phone?, roleId?, status? } → { data: UserDetail } */
usersRouter.patch("/:id", validate({ params: idParams, body: updateUserSchema }), async (req, res) => {
    ok(res, await users.updateUser(req.valid.params.id, req.valid.body, req.user, auditCtx(req)));
});

/** POST /api/users/:id/reset-password → { data: { tempPassword } } (shown once) */
usersRouter.post("/:id/reset-password", validate({ params: idParams }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    ok(res, await users.resetPassword(req.valid.params.id, req.user, auditCtx(req)));
});

/** POST /api/users/:id/unlock → { data: UserDetail } */
usersRouter.post("/:id/unlock", validate({ params: idParams }), async (req, res) => {
    ok(res, await users.unlockUser(req.valid.params.id, req.user, auditCtx(req)));
});
