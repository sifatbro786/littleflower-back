import { z } from "zod";

import { STAFF_PERMISSIONS } from "#core/rbac.js";

const permissions = z
    .array(z.enum(STAFF_PERMISSIONS, "Unknown permission."))
    .max(STAFF_PERMISSIONS.length)
    .transform((list) => [...new Set(list)].sort());

export const roleIdParams = z.object({ id: z.uuid("Not found") });

export const createRoleSchema = z.object({
    name: z.string().trim().min(2, "Give the role a name.").max(60),
    description: z.string().trim().max(200).optional(),
    permissions,
});

export const updateRoleSchema = z
    .object({
        name: z.string().trim().min(2, "Give the role a name.").max(60).optional(),
        description: z.string().trim().max(200).nullable().optional(),
        permissions: permissions.optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
