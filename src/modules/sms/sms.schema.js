import { z } from "zod";

export const sendSchema = z.object({
    /** "all" | "dues" | a section id */
    audience: z.union([z.enum(["all", "dues"]), z.uuid()]),
    templateId: z.uuid().nullable().optional(),
    body: z.string().trim().min(3, "Write the message.").max(1000, "Keep it under 1000 characters."),
});
export const templateParams = z.object({ id: z.uuid("Not found") });
export const templateSchema = z
    .object({ name: z.string().trim().min(2).max(60).optional(), body: z.string().trim().min(3).max(1000).optional(), isActive: z.boolean().optional() })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
