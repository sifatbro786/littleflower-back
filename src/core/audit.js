import { logger } from "#core/logger.js";
import { prisma } from "#core/prisma.js";

/**
 * Audit log (PRD §5): who did what, when, from where. Append only.
 * Inside a money/result transaction pass the tx client so the audit row commits or rolls back with it.
 *
 * @typedef {Object} AuditCtx
 * @property {string | null} actorId
 * @property {string | null} ip
 * @property {string | null} userAgent
 */

/** @param {import("express").Request} req @returns {AuditCtx} */
export function auditCtx(req) {
    return {
        actorId: req.user?.id ?? null,
        ip: req.clientIp ?? null,
        userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
    };
}

/**
 * @param {AuditCtx} ctx
 * @param {{ action: string, entity: string, entityId?: string | null, before?: unknown, after?: unknown, actorId?: string | null }} entry
 * @param {import("@prisma/client").Prisma.TransactionClient} [db]
 */
export function audit(ctx, entry, db = prisma) {
    return db.auditLog.create({
        data: {
            actorId: entry.actorId !== undefined ? entry.actorId : ctx.actorId,
            action: entry.action,
            entity: entry.entity,
            entityId: entry.entityId ?? null,
            before: entry.before ?? undefined,
            after: entry.after ?? undefined,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
        },
    });
}

/** Fire-and-forget variant for events outside a transaction (login, logout): never fails the request. */
export function auditQuiet(ctx, entry) {
    audit(ctx, entry).catch((err) => logger.error({ err: err.message, action: entry.action }, "audit write failed"));
}
