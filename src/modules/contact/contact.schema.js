import { z } from "zod";

import { normalizeBdPhone } from "#core/phone.js";

/** Website contact form (same fields and messages as littleflower-front lib/server/contact-schema.js). */
export const contactSchema = z.object({
    name: z.string().trim().min(2, "Please write your name.").max(80),
    phone: z
        .string()
        .trim()
        .transform((v, ctx) => {
            const p = normalizeBdPhone(v);
            if (!p) ctx.addIssue({ code: "custom", message: "Please give a valid Bangladeshi mobile number." });
            return p ?? v;
        }),
    email: z.union([z.literal(""), z.email("This email address does not look right.").trim().max(120)]).optional(),
    subject: z.enum(["admission", "general", "fees", "other"]).default("general"),
    message: z.string().trim().min(10, "Please write a little more (at least 10 characters).").max(1500),
});
