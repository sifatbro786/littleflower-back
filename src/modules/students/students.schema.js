import { z } from "zod";

import { normalizeBdPhone } from "#core/phone.js";

const nullable = (schema) => z.preprocess((v) => (v === "" ? null : v), schema.nullable()).optional();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.");
const phone = (msg) =>
    z
        .string()
        .trim()
        .transform((v, ctx) => {
            const p = normalizeBdPhone(v);
            if (!p) ctx.addIssue({ code: "custom", message: msg });
            return p ?? v;
        });

export const idParams = z.object({ id: z.uuid("Not found") });

export const listQuery = z.object({
    sectionId: z.uuid().optional(),
    q: z.string().trim().max(80).optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "TRANSFERRED", "GRADUATED", "all"]).default("ACTIVE"),
});

const profile = {
    name: z.string().trim().min(2, "Write the student's name.").max(80),
    dob: z.string("Give the date of birth.").regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date of birth."),
    gender: z.enum(["MALE", "FEMALE"], "Choose boy or girl."),
    bloodGroup: nullable(z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])),
    fatherName: nullable(z.string().trim().max(80)),
    motherName: nullable(z.string().trim().max(80)),
    guardianName: nullable(z.string().trim().max(80)),
    guardianPhone: phone("Give the guardian's mobile number (01XXXXXXXXX)."),
    guardianPhone2: nullable(phone("Use a Bangladeshi mobile number.")),
    guardianEmail: nullable(z.email("This email address does not look right.").trim().toLowerCase().max(120)),
    address: nullable(z.string().trim().max(300)),
    admissionDate: nullable(ymd),
};

export const createStudentSchema = z.object({
    ...profile,
    sectionId: z.uuid("Choose a class."),
    /** Empty → next free roll in the section */
    roll: z.number().int().min(1).max(999).nullish(),
});

export const updateStudentSchema = z
    .object({
        ...Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, v.optional()])),
        status: z.enum(["ACTIVE", "INACTIVE", "TRANSFERRED", "GRADUATED"]).optional(),
        /** Current-session placement */
        sectionId: z.uuid().optional(),
        roll: z.number().int().min(1).max(999).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

export const promoteSchema = z.object({
    fromSectionId: z.uuid(),
    toSessionId: z.uuid("Choose the new session."),
    toSectionId: z.uuid("Choose the new class."),
    studentIds: z.array(z.uuid()).min(1, "Pick at least one student.").max(200),
    /** keep = same roll numbers; name = 1, 2, 3 … by name */
    rollMode: z.enum(["keep", "name"]).default("keep"),
});

/* ------------------------------ CSV import (Step 5) ------------------------------ */

/** "2015-03-09" or "09/03/2015" / "9-3-2015" (day first, Bangladesh) → "2015-03-09" */
const looseDate = (msg) =>
    z.preprocess(
        (v) => {
            if (typeof v !== "string") return v;
            const s = v.trim();
            if (!s) return null;
            const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
            const bd = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
            const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : bd ? [bd[3], bd[2], bd[1]] : [];
            if (!y) return s;
            const out = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
            return new Date(`${out}T00:00:00Z`).toISOString().startsWith(out) ? out : s;
        },
        z.string(msg).regex(/^\d{4}-\d{2}-\d{2}$/, msg),
    );
const gender = z.preprocess((v) => {
    const s = String(v ?? "").trim().toLowerCase();
    if (["m", "male", "boy", "b"].includes(s)) return "MALE";
    if (["f", "female", "girl", "g"].includes(s)) return "FEMALE";
    return s;
}, z.enum(["MALE", "FEMALE"], "Use Male or Female."));
const blank = (schema) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable()).optional();

export const importRow = z.object({
    name: profile.name,
    gender,
    dob: looseDate("Date of birth: use YYYY-MM-DD or DD/MM/YYYY."),
    class: z.string("Write the class (e.g. Class III).").trim().min(1, "Write the class (e.g. Class III)."),
    /** Section name (e.g. "A" or "English Version"). Empty = the class's only section. */
    section: z.string().trim().max(20).optional().default(""),
    roll: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number("Roll must be a number").int("Roll must be a number").min(1).max(999).nullable()).optional(),
    fatherName: blank(z.string().trim().max(80)),
    motherName: blank(z.string().trim().max(80)),
    guardianName: blank(z.string().trim().max(80)),
    guardianPhone: profile.guardianPhone,
    guardianPhone2: blank(phone("Use a Bangladeshi mobile number.")),
    guardianEmail: blank(z.email("This email address does not look right.").trim().toLowerCase().max(120)),
    bloodGroup: blank(z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase().replace(/\s+/g, "").replace("VE", "") : v), z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"], "Blood group like A+ or O-."))),
    address: blank(z.string().trim().max(300)),
    admissionDate: blank(looseDate("Admission date: use YYYY-MM-DD or DD/MM/YYYY.")),
});

/** Rows are validated one by one in the service (per-row errors), so only the envelope is checked here. */
export const importSchema = z.object({
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(200, "Send at most 200 rows at a time."),
    /** Row numbers as in the file (header = row 1), for error messages */
    firstRow: z.number().int().min(2).default(2),
    dryRun: z.boolean().default(true),
});
