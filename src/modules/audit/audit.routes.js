import { Router } from "express";

import { ok } from "#core/http.js";
import { requirePermission } from "#core/rbac.js";
import { validate } from "#core/validate.js";

import { listAuditQuery } from "./audit.schema.js";
import { listAudit } from "./audit.service.js";

export const auditRouter = Router();
auditRouter.use(requirePermission("audit.view"));

/** GET /api/audit?limit=&cursor=&entity=&action=&actorId=&from=&to= → { data: AuditRow[], meta: { nextCursor } } */
auditRouter.get("/", validate({ query: listAuditQuery }), async (req, res) => {
    const { rows, nextCursor } = await listAudit(req.valid.query);
    ok(res, rows, { meta: { nextCursor } });
});
