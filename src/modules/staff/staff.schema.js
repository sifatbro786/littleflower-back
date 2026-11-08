import { z } from "zod";

import { normalizeBdPhone } from "#core/phone.js";
import { STORED_PATH } from "#core/storage.js";

const nullable = (schema) => z.preprocess((v) => (v === "" ? null : v), schema.nullable()).optional();

const phone = z
    .string()
    .trim()
    .transform((v, ctx) => {
        const p = normalizeBdPhone(v);
        if (!p) ctx.addIssue({ code: "custom", message: "Use a Bangladeshi mobile number (01XXXXXXXXX)." });
        return p ?? v;
    });

export const idParams = z.object({ id: z.uuid("Not found") });

const fields = {
    name: z.string().trim().min(2, "Write the name.").max(80),
    designation: z.string().trim().min(2, "Write the designation.").max(80),
    qualification: nullable(z.string().trim().max(120)),
    phone: nullable(phone),
    email: nullable(z.email("This email address does not look right.").trim().toLowerCase().max(120)),
    /** Public photo (shown on the website when showOnWebsite) */
    photoPath: nullable(z.string().regex(STORED_PATH, "Upload the photo again.")),
    group: z.enum(["TEACHER", "OFFICE"]).default("TEACHER"),
    showOnWebsite: z.boolean().default(false),
    order: z.number().int().min(0).max(999).default(0),
    joinedAt: nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.")),
};

export const createStaffSchema = z.object(fields);
export const updateStaffSchema = z
    .object({ ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])), isActive: z.boolean().optional() })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
