import { z } from "zod";

import { normalizeBdPhone } from "#core/phone.js";

const email = z
    .email("This email address does not look right.")
    .trim()
    .max(120)
    .transform((v) => v.toLowerCase());

const phone = z
    .string()
    .trim()
    .transform((v, ctx) => {
        const p = normalizeBdPhone(v);
        if (!p) ctx.addIssue({ code: "custom", message: "Use a Bangladeshi mobile number (01XXXXXXXXX)." });
        return p ?? v;
    });

/** "" from a form field means "not set" (null). Preprocess, not a union, so the field's own message survives. */
const optional = (schema) => z.preprocess((v) => (v === "" ? null : v), schema.nullable()).optional();

export const idParams = z.object({ id: z.uuid("Not found") });

export const listUsersQuery = z.object({
    q: z.string().trim().max(80).optional(),
    roleId: z.uuid().optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const createUserSchema = z
    .object({
        name: z.string().trim().min(2, "Write the person's name.").max(80),
        email: optional(email),
        phone: optional(phone),
        roleId: z.uuid("Choose a role."),
        /** Empty → the API generates a one-time password and returns it once. */
        password: optional(z.string().min(8, "Use at least 8 characters.").max(200)),
        /** Link an existing staff record (teacher "own" scopes come from this link). */
        staffId: optional(z.uuid()),
    })
    .refine((v) => v.email || v.phone, { path: ["email"], message: "Give an email or a mobile number to sign in with." });

export const updateUserSchema = z
    .object({
        name: z.string().trim().min(2, "Write the person's name.").max(80).optional(),
        email: optional(email),
        phone: optional(phone),
        roleId: z.uuid().optional(),
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
