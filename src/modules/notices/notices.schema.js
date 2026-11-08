import { z } from "zod";

export const idParams = z.object({ id: z.uuid("Not found") });

const fields = {
    title: z.string().trim().min(3, "Write a title.").max(150),
    bodyHtml: z.string().max(50_000).default(""),
    audience: z.enum(["PUBLIC", "ALL", "STAFF", "CLASS"]),
    classId: z.uuid().nullable().optional(),
    category: z.enum(["GENERAL", "ADMISSION", "EXAM", "HOLIDAY", "EVENT"]).default("GENERAL"),
    pinned: z.boolean().default(false),
    /** null = draft, future = scheduled */
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    pdfPath: z
        .string()
        .regex(/^public\/notices\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/, "Upload the PDF again.")
        .nullable()
        .optional(),
    /** Also SMS the guardians (ALL / CLASS only, when it is published now) */
    sendSms: z.boolean().default(false),
};

const classRule = (v) => (v.audience === "CLASS" ? Boolean(v.classId) : true);

export const createNoticeSchema = z.object(fields).refine(classRule, { path: ["classId"], message: "Choose the class." });
export const updateNoticeSchema = z
    .object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])))
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." })
    .refine((v) => (v.audience === "CLASS" ? Boolean(v.classId) : true), { path: ["classId"], message: "Choose the class." });
export const listQuery = z.object({ classId: z.uuid().optional() });
