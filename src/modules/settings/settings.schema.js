import { z } from "zod";

/**
 * Every school-specific setting the API understands (Setting table key → JSON value).
 * The admin screen edits exactly these; unknown keys are rejected. Defaults apply when a row is missing.
 */
export const MODULES = ["cms", "students", "results", "attendance", "routine", "cards", "fees", "sms", "portal"];
const WEEKDAYS = ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"];
const text = (max) => z.string().trim().max(max);
const url = z.union([z.literal(""), z.url("Enter a full link starting with https://").max(300)]);

export const SETTING_SCHEMAS = {
    "school.profile": z
        .object({
            name: text(120).min(3, "Write the school name."),
            shortName: text(40).min(2, "Write a short name (used in SMS)."),
            eiin: text(20).optional().default(""),
            established: z.coerce.number().int().min(1900).max(2100).nullish(),
            contact: z
                .object({
                    phone: text(30).optional().default(""),
                    whatsapp: text(30).optional().default(""),
                    email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().default(""),
                    addressLines: z.array(text(120)).max(4).optional().default([]),
                    addressShort: text(120).optional().default(""),
                    officeHours: text(120).optional().default(""),
                })
                .passthrough(),
            social: z.object({ facebook: url.optional().default(""), youtube: url.optional().default("") }).passthrough(),
        })
        .passthrough(),
    "modules.enabled": z.array(z.enum(MODULES)).max(MODULES.length).refine((v) => v.includes("students"), "Students & classes cannot be turned off."),
    "ids.studentUidPrefix": z.string().regex(/^[A-Z0-9]{2,8}-?$/, "2–8 capital letters or digits, optional dash (e.g. LFIS-)."),
    "fees.receiptPrefix": z.string().regex(/^[A-Z0-9]{2,8}$/, "2–8 capital letters or digits (e.g. LFIS)."),
    "fees.autoInvoiceDay": z.number().int().min(1).max(28).nullable(),
    "attendance.weeklyOff": z.array(z.enum(WEEKDAYS)).max(3).refine((v) => new Set(v).size === v.length, "Each day once."),
    "attendance.smsCutoff": z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm"),
    "results.tieBreak": z.enum(["roll", "name"]),
    "cards.admitDueLimit": z.number().int().min(0).max(10_000_000).nullable(),
};

export const DEFAULTS = {
    "school.profile": { name: "School", shortName: "School", eiin: "", contact: {}, social: {} },
    "modules.enabled": MODULES,
    "ids.studentUidPrefix": "STU-",
    "fees.receiptPrefix": "RCPT",
    "fees.autoInvoiceDay": null,
    "attendance.weeklyOff": ["FRI", "SAT"],
    "attendance.smsCutoff": "10:30",
    "results.tieBreak": "roll",
    "cards.admitDueLimit": null,
};

/** PATCH body: any subset of the keys above. */
export const patchSchema = z
    .object(Object.fromEntries(Object.entries(SETTING_SCHEMAS).map(([k, s]) => [k, s.optional()])))
    .strict()
    .refine((v) => Object.keys(v).length > 0, "Nothing to save.");
