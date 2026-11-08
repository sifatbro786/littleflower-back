import { Router } from "express";

import { requireAuth } from "#core/auth.js";
import { auditCtx } from "#core/audit.js";
import { forbidden } from "#core/errors.js";
import { ok } from "#core/http.js";
import { can, requireAnyPermission, requirePermission, ROLE_KEYS } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import * as s from "./exams.schema.js";
import * as exams from "./exams.service.js";

/**
 * /api/exams — exams.manage sets up exams and moves the status; marks.enter (teachers: own subjects)
 * enters marks; results.publish publishes; only the Super Admin unpublishes.
 * Portal / profile results: /api/exams/students/:studentId/results (guardian own child, staff students.view).
 */
export const examsRouter = Router();

const manage = requirePermission("exams.manage");
const marks = requireAnyPermission("marks.enter", "exams.manage");
const listing = requireAnyPermission("exams.manage", "marks.enter", "results.publish", "cards.generate", "dashboard.view");
const superAdmin = (req, _res, next) => (req.user?.role === ROLE_KEYS.SUPER_ADMIN ? next() : next(forbidden("Only the Super Admin can unpublish results.")));
const studentAccess = (req, _res, next) => (req.user.role === ROLE_KEYS.STUDENT || can(req.user, "students.view") ? next() : next(forbidden()));

examsRouter.get("/", listing, async (_req, res) => ok(res, await exams.listExams()));
examsRouter.get("/upcoming", requireAuth, async (_req, res) => ok(res, await exams.upcomingExams()));
examsRouter.get("/marks-options", marks, async (req, res) => ok(res, await exams.marksOptions(req.user)));

examsRouter.get("/students/:studentId/results", requireAuth, studentAccess, validate({ params: s.studentParams }), async (req, res) => ok(res, await exams.studentResults(req.valid.params.studentId, req.user)));
examsRouter.get("/students/:studentId/results/:examId", requireAuth, studentAccess, validate({ params: s.studentExamParams }), async (req, res) =>
    ok(res, await exams.studentMarksheet(req.valid.params.studentId, req.valid.params.examId, req.user)),
);

examsRouter.get("/students/:studentId/admit-card", requireAuth, studentAccess, validate({ params: s.studentParams }), async (req, res) => ok(res, await exams.admitCard(req.valid.params.studentId, req.user)));

examsRouter.post("/", manage, validate({ body: s.createSchema }), async (req, res) => ok(res, await exams.createExam(req.valid.body, auditCtx(req)), { status: 201 }));
examsRouter.get("/:id", manage, validate({ params: s.idParams }), async (req, res) => ok(res, await exams.getExam(req.valid.params.id)));
examsRouter.patch("/:id", manage, validate({ params: s.idParams, body: s.patchSchema }), async (req, res) => ok(res, await exams.updateExam(req.valid.params.id, req.valid.body, auditCtx(req))));
examsRouter.delete("/:id", manage, validate({ params: s.idParams }), async (req, res) => ok(res, await exams.deleteExam(req.valid.params.id, auditCtx(req))));
examsRouter.put("/:id/subjects", manage, validate({ params: s.idParams, body: s.subjectsSchema }), async (req, res) => ok(res, await exams.updateSubjects(req.valid.params.id, req.valid.body, auditCtx(req))));
examsRouter.post("/:id/status", manage, validate({ params: s.idParams, body: s.statusSchema }), async (req, res) => ok(res, await exams.setStatus(req.valid.params.id, req.valid.body.status, auditCtx(req))));

examsRouter.get("/:id/marks", marks, validate({ params: s.idParams, query: s.sheetQuery }), async (req, res) => ok(res, await exams.getMarksSheet(req.valid.params.id, req.valid.query, req.user)));
examsRouter.put("/:id/marks", marks, validate({ params: s.idParams, body: s.saveMarksSchema }), async (req, res) => ok(res, await exams.saveMarks(req.valid.params.id, req.valid.body, req.user, auditCtx(req))));

examsRouter.get("/:id/tabulation", requireAnyPermission("exams.manage", "results.publish"), validate({ params: s.idParams, query: s.tabulationQuery }), async (req, res) =>
    ok(res, await exams.getTabulation(req.valid.params.id, req.valid.query.sectionId)),
);
examsRouter.post("/:id/publish", requirePermission("results.publish"), validate({ params: s.idParams, body: s.publishSchema }), async (req, res) => ok(res, await exams.publish(req.valid.params.id, req.valid.body, auditCtx(req))));
examsRouter.post("/:id/unpublish", superAdmin, validate({ params: s.idParams }), async (req, res) => ok(res, await exams.unpublish(req.valid.params.id, auditCtx(req))));
