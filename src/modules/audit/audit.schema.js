import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const listAuditQuery = z.object({
    limit: z.coerce.number().int().min(1).max(500).default(200),
    /** Opaque cursor from meta.nextCursor */
    cursor: z.string().max(80).optional(),
    entity: z.string().max(40).optional(),
    /** Exact action ("role.update") or a prefix ending in "." ("auth.") */
    action: z.string().max(60).optional(),
    actorId: z.uuid().optional(),
    /** Dhaka calendar dates, inclusive */
    from: ymd.optional(),
    to: ymd.optional(),
});
