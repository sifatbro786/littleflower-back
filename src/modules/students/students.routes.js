import { Router } from "express";
import multer from "multer";

import { env } from "#config/env.js";
import { requireAuth } from "#core/auth.js";
import { auditCtx } from "#core/audit.js";
import { AppError, forbidden } from "#core/errors.js";
import { ok } from "#core/http.js";
import { rateLimit } from "#core/rate-limit.js";
import { can, requirePermission, ROLE_KEYS } from "#core/rbac.js";
import { absolutePath, storeImage } from "#core/storage.js";
import { validate } from "#core/validate.js";

import { createStudentSchema, idParams, importSchema, listQuery, promoteSchema, updateStudentSchema } from "./students.schema.js";
import * as students from "./students.service.js";

/** /api/students — staff with students.view (teachers: own sections); a guardian may read only their own child. */
export const studentsRouter = Router();

const view = requirePermission("students.view");
const manage = requirePermission("students.manage");
/** Staff with students.view, or the signed-in student/guardian (own record is enforced by the service → 404). */
const viewOrSelf = [requireAuth, (req, _res, next) => (req.user.role === ROLE_KEYS.STUDENT || can(req.user, "students.view") ? next() : next(forbidden()))];

studentsRouter.get("/", view, validate({ query: listQuery }), async (req, res) => ok(res, await students.listStudents(req.valid.query, req.user)));
studentsRouter.get("/counts", view, async (_req, res) => ok(res, await students.studentCounts()));
/** CSV import: dryRun validates only; a commit saves the batch all-or-nothing and returns one-time passwords once. */
studentsRouter.post(
    "/import",
    manage,
    rateLimit({ name: "students:import", limit: 60, windowSec: 600, key: (req) => req.user.id }),
    validate({ body: importSchema }),
    async (req, res) => ok(res, await students.importStudents(req.valid.body, auditCtx(req))),
);
studentsRouter.post("/", manage, validate({ body: createStudentSchema }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    ok(res, await students.createStudent(req.valid.body, auditCtx(req)), { status: 201 });
});
studentsRouter.post("/promote", manage, validate({ body: promoteSchema }), async (req, res) => ok(res, await students.promote(req.valid.body, auditCtx(req))));

studentsRouter.get("/:id", ...viewOrSelf, validate({ params: idParams }), async (req, res) => ok(res, await students.getStudent(req.valid.params.id, req.user)));
studentsRouter.patch("/:id", manage, validate({ params: idParams, body: updateStudentSchema }), async (req, res) => ok(res, await students.updateStudent(req.valid.params.id, req.valid.body, auditCtx(req))));
studentsRouter.post("/:id/portal-reset", manage, validate({ params: idParams }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    ok(res, await students.resetPortal(req.valid.params.id, auditCtx(req)));
});

/** POST /api/students/:id/photo (multipart "file") → private WebP. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }).single("file");
studentsRouter.post("/:id/photo", manage, validate({ params: idParams }), (req, res, next) => upload(req, res, (err) => (err ? next(new AppError(400, "BAD_REQUEST", "Upload one photo up to 10 MB.")) : next())), async (req, res) => {
    if (!req.file) throw new AppError(400, "BAD_REQUEST", "No file received.");
    const img = await storeImage(req.file.buffer, { folder: "students", area: "private", maxSize: 800, thumbSize: 200 });
    ok(res, await students.setPhoto(req.valid.params.id, img.path, auditCtx(req)));
});

/**
 * GET /api/students/:id/photo — scope-checked, never cached publicly. Production: Nginx serves the file
 * via X-Accel-Redirect from an `internal` location (deploy notes); development: Express streams it.
 */
studentsRouter.get("/:id/photo", ...viewOrSelf, validate({ params: idParams }), async (req, res) => {
    const rel = await students.photoPathFor(req.valid.params.id, req.user);
    res.set("Cache-Control", "private, max-age=300");
    if (env.isProd) {
        res.set("X-Accel-Redirect", `/_protected/${rel.replace(/^private\//, "")}`);
        res.set("Content-Type", "image/webp");
        return res.end();
    }
    res.sendFile(absolutePath(rel));
});
