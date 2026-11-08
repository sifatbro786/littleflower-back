import { Router } from "express";

import { requireAuth } from "#core/auth.js";
import { auditCtx } from "#core/audit.js";
import { forbidden } from "#core/errors.js";
import { ok } from "#core/http.js";
import { can, requireAnyPermission, requirePermission, ROLE_KEYS } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import * as s from "./attendance.schema.js";
import * as att from "./attendance.service.js";

/** /api/attendance — teachers (own sections) take it; attendance.view sees reports; guardians their child's month. */
export const attendanceRouter = Router();

const takeOrView = requireAnyPermission("attendance.take", "attendance.view");
const view = requirePermission("attendance.view");

attendanceRouter.get("/dates", takeOrView, validate({ query: s.datesQuery }), async (req, res) => ok(res, await att.recentSchoolDays(req.valid.query.n)));
attendanceRouter.get("/sheet", takeOrView, validate({ query: s.sheetQuery }), async (req, res) => ok(res, await att.getSheet(req.valid.query.sectionId, req.valid.query.date, req.user)));
attendanceRouter.put("/sheet", takeOrView, validate({ body: s.saveSchema }), async (req, res) => ok(res, await att.saveSheet(req.valid.body, req.user, auditCtx(req))));

attendanceRouter.get("/summary", requireAnyPermission("attendance.view", "attendance.take", "dashboard.view"), validate({ query: s.summaryQuery }), async (req, res) => ok(res, await att.summary(req.valid.query.date)));
attendanceRouter.get("/trend", requireAnyPermission("attendance.view", "dashboard.view"), validate({ query: s.trendQuery }), async (req, res) => ok(res, await att.trend(req.valid.query.days)));
attendanceRouter.get("/report", takeOrView, validate({ query: s.reportQuery }), async (req, res) => ok(res, await att.monthlyReport(req.valid.query.sectionId, req.valid.query.month, req.user)));

/** Own child (guardian) or staff with attendance / students access (teacher scope in the service). */
attendanceRouter.get(
    "/students/:studentId",
    requireAuth,
    (req, _res, next) => (req.user.role === ROLE_KEYS.STUDENT || can(req.user, "attendance.view") || can(req.user, "attendance.take") || can(req.user, "students.view") ? next() : next(forbidden())),
    validate({ params: s.studentParams, query: s.studentMonthQuery }),
    async (req, res) => ok(res, await att.studentMonth(req.valid.params.studentId, req.valid.query.month, req.user)),
);

attendanceRouter.get("/holidays", takeOrView, async (_req, res) => ok(res, await att.listHolidays()));
attendanceRouter.post("/holidays", view, requirePermission("academics.manage"), validate({ body: s.holidaySchema }), async (req, res) => ok(res, await att.addHolidays(req.valid.body, auditCtx(req)), { status: 201 }));
attendanceRouter.delete("/holidays/:date", view, requirePermission("academics.manage"), validate({ params: s.holidayParams }), async (req, res) => ok(res, await att.removeHoliday(req.valid.params.date, auditCtx(req))));
