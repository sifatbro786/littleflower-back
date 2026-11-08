import { Router } from "express";

import { academicsRouter } from "./academics/academics.routes.js";
import { attendanceRouter } from "./attendance/attendance.routes.js";
import { auditRouter } from "./audit/audit.routes.js";
import { authRouter } from "./auth/auth.routes.js";
import { cmsRouter } from "./cms/cms.routes.js";
import { contactRouter } from "./contact/contact.routes.js";
import { examsRouter } from "./exams/exams.routes.js";
import { feesRouter, paymentsRouter } from "./fees/fees.routes.js";
import { healthRouter } from "./health/health.routes.js";
import { noticesRouter } from "./notices/notices.routes.js";
import { publicRouter } from "./public/public.routes.js";
import { rolesRouter } from "./roles/roles.routes.js";
import { settingsRouter } from "./settings/settings.routes.js";
import { requireModule } from "./settings/settings.service.js";
import { routineRouter } from "./routine/routine.routes.js";
import { smsRouter } from "./sms/sms.routes.js";
import { staffRouter } from "./staff/staff.routes.js";
import { studentsRouter } from "./students/students.routes.js";
import { uploadsRouter } from "./uploads/uploads.routes.js";
import { usersRouter } from "./users/users.routes.js";

/**
 * Module registry. Every module exports one router; mount it here under /api.
 * requireModule(): modules a school turned off in settings (modules.enabled) answer 404 MODULE_OFF.
 * Students, academics, staff, users, notices and the public website API are always on.
 * Steps 2–4 add: auth, users, audit, cms, public, uploads, academics, students, attendance,
 * routine, notices, sms, exams, results, fees, payments, portal.
 */
export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/contact", contactRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/roles", rolesRouter);
apiRouter.use("/audit", auditRouter);
apiRouter.use("/public", publicRouter);
apiRouter.use("/cms", requireModule("cms"), cmsRouter);
apiRouter.use("/uploads", uploadsRouter);
apiRouter.use("/academics", academicsRouter);
apiRouter.use("/staff", staffRouter);
apiRouter.use("/students", studentsRouter);
apiRouter.use("/attendance", requireModule("attendance"), attendanceRouter);
apiRouter.use("/routine", requireModule("routine"), routineRouter);
apiRouter.use("/notices", noticesRouter);
apiRouter.use("/sms", requireModule("sms"), smsRouter);
apiRouter.use("/exams", requireModule("results"), examsRouter);
apiRouter.use("/fees", requireModule("fees"), feesRouter);
apiRouter.use("/payments", requireModule("fees"), paymentsRouter);
apiRouter.use("/settings", settingsRouter);
