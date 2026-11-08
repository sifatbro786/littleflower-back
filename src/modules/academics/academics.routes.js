import { Router } from "express";
import { z } from "zod";

import { auditCtx } from "#core/audit.js";
import { notFound } from "#core/errors.js";
import { ok } from "#core/http.js";
import { can, requirePermission, requireStaffUser } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import * as s from "./academics.schema.js";
import * as a from "./academics.service.js";

/**
 * /api/academics/* — reads for any staff member (selects, own scopes), writes need academics.manage.
 */
export const academicsRouter = Router();
academicsRouter.use(requireStaffUser);

const manage = requirePermission("academics.manage");
const id = validate({ params: s.idParams });

academicsRouter.get("/sessions", async (_req, res) => ok(res, await a.listSessions()));
academicsRouter.get("/classes", async (_req, res) => ok(res, await a.listClasses()));
academicsRouter.get("/sections", async (_req, res) => ok(res, await a.listSectionOptions()));
academicsRouter.get("/grade-scale", async (_req, res) => ok(res, await a.getGradeScale()));

/** A teacher may read their own assignments; academics.manage may read anyone's. Others get 404. */
const staffParams = validate({ params: z.object({ staffId: z.uuid("Not found") }) });
const ownOrManager = (req, _res, next) => (req.user.staffId === req.valid.params.staffId || can(req.user, "academics.manage") ? next() : next(notFound()));
academicsRouter.get("/teachers/:staffId/assignments", staffParams, ownOrManager, async (req, res) => ok(res, await a.teacherAssignments(req.valid.params.staffId)));
academicsRouter.get("/teachers/:staffId/sections", staffParams, ownOrManager, async (req, res) => ok(res, await a.teacherSections(req.valid.params.staffId)));

academicsRouter.post("/sessions", manage, validate({ body: s.createSessionSchema }), async (req, res) => ok(res, await a.createSession(req.valid.body, auditCtx(req)), { status: 201 }));
academicsRouter.post("/sessions/:id/current", manage, id, async (req, res) => ok(res, await a.setCurrentSession(req.valid.params.id, auditCtx(req))));

academicsRouter.get("/classes/:id", manage, id, async (req, res) => ok(res, await a.getClass(req.valid.params.id)));
academicsRouter.post("/classes", manage, validate({ body: s.createClassSchema }), async (req, res) => ok(res, await a.createClass(req.valid.body, auditCtx(req)), { status: 201 }));
academicsRouter.patch("/classes/:id", manage, validate({ params: s.idParams, body: s.updateClassSchema }), async (req, res) => ok(res, await a.updateClass(req.valid.params.id, req.valid.body, auditCtx(req))));

academicsRouter.post("/classes/:id/sections", manage, validate({ params: s.idParams, body: s.sectionSchema }), async (req, res) => ok(res, await a.addSection(req.valid.params.id, req.valid.body, auditCtx(req)), { status: 201 }));
academicsRouter.patch("/sections/:id", manage, validate({ params: s.idParams, body: s.sectionSchema }), async (req, res) => ok(res, await a.renameSection(req.valid.params.id, req.valid.body, auditCtx(req))));
academicsRouter.delete("/sections/:id", manage, id, async (req, res) => ok(res, await a.deleteSection(req.valid.params.id, auditCtx(req))));
academicsRouter.put("/sections/:id/class-teacher", manage, validate({ params: s.idParams, body: s.classTeacherSchema }), async (req, res) => ok(res, await a.setClassTeacher(req.valid.params.id, req.valid.body, auditCtx(req))));
academicsRouter.put("/sections/:id/assignments", manage, validate({ params: s.idParams, body: s.assignmentsSchema }), async (req, res) => ok(res, await a.setAssignments(req.valid.params.id, req.valid.body, auditCtx(req))));

academicsRouter.post("/classes/:id/subjects", manage, validate({ params: s.idParams, body: s.createSubjectSchema }), async (req, res) => ok(res, await a.addSubject(req.valid.params.id, req.valid.body, auditCtx(req)), { status: 201 }));
academicsRouter.put("/classes/:id/subjects/order", manage, validate({ params: s.idParams, body: s.orderSchema }), async (req, res) => ok(res, await a.reorderSubjects(req.valid.params.id, req.valid.body.ids)));
academicsRouter.patch("/subjects/:id", manage, validate({ params: s.idParams, body: s.updateSubjectSchema }), async (req, res) => ok(res, await a.updateSubject(req.valid.params.id, req.valid.body, auditCtx(req))));
academicsRouter.delete("/subjects/:id", manage, id, async (req, res) => ok(res, await a.deleteSubject(req.valid.params.id, auditCtx(req))));
