import { badRequest } from "#core/errors.js";
import { prisma } from "#core/prisma.js";

/** Read side of the audit log (writes go through #core/audit.js). Entries are never edited or deleted. */

/** Fallback text for entries written without after.detail. */
const DESCRIBE = {
    "auth.login": "Signed in",
    "auth.lockout": "Account locked after repeated wrong passwords",
    "auth.password_change": "Changed own password",
    "auth.token_reuse": "Old sign-in token reused: all sessions of that sign-in ended",
};

const encodeCursor = (row) => Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");
function decodeCursor(c) {
    const [iso, id] = Buffer.from(c, "base64url").toString().split("|");
    const at = new Date(iso);
    if (!id || Number.isNaN(at.getTime())) throw badRequest("Invalid cursor");
    return { at, id };
}

/** Dhaka date (YYYY-MM-DD) → instant at local midnight (UTC+6, no DST). */
const dhakaStart = (ymd) => new Date(`${ymd}T00:00:00+06:00`);

/**
 * Newest first, keyset paginated on (createdAt, id).
 * @param {{ limit: number, cursor?: string, entity?: string, action?: string, actorId?: string, from?: string, to?: string }} q
 * @returns {Promise<{ rows: object[], nextCursor: string | null }>}
 */
export async function listAudit(q) {
    const and = [];
    if (q.entity) and.push({ entity: q.entity });
    if (q.action) and.push(q.action.endsWith(".") ? { action: { startsWith: q.action } } : { action: q.action });
    if (q.actorId) and.push({ actorId: q.actorId });
    if (q.from) and.push({ createdAt: { gte: dhakaStart(q.from) } });
    if (q.to) and.push({ createdAt: { lt: new Date(dhakaStart(q.to).getTime() + 86_400_000) } });
    if (q.cursor) {
        const c = decodeCursor(q.cursor);
        and.push({ OR: [{ createdAt: { lt: c.at } }, { createdAt: c.at, id: { lt: c.id } }] });
    }

    const rows = await prisma.auditLog.findMany({
        where: and.length ? { AND: and } : {},
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: q.limit + 1,
        select: { id: true, action: true, entity: true, entityId: true, after: true, ip: true, createdAt: true, actorId: true, actor: { select: { name: true } } },
    });
    const more = rows.length > q.limit;
    const page = more ? rows.slice(0, q.limit) : rows;

    return {
        // Shape of littleflower-front lib/dashboard/comms listAudit() rows.
        rows: page.map((r) => ({
            id: r.id,
            createdAt: r.createdAt.toISOString(),
            actor: r.actor?.name ?? "System",
            actorId: r.actorId,
            action: r.action,
            entity: r.entity,
            entityId: r.entityId,
            detail: (r.after && typeof r.after === "object" && typeof r.after.detail === "string" ? r.after.detail : null) ?? DESCRIBE[r.action] ?? `${r.action} on ${r.entity}`,
            ip: r.ip ?? "",
        })),
        nextCursor: more ? encodeCursor(page.at(-1)) : null,
    };
}
