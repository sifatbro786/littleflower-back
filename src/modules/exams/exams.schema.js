import { z } from "zod";

const ymd = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Invalid date");
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const marksInt = z.coerce.number().int("Whole numbers only").min(1).max(500);
/** Half marks allowed (Decimal(5,2) column). */
const obtained = z
    .number()
    .min(0, "Marks cannot be negative")
    .max(500)
    .refine((v) => Number.isInteger(v * 2), "Use whole or half marks (e.g. 45 or 45.5)");

const datesOk = (v) => !v.startDate || !v.endDate || v.endDate >= v.startDate;
const datesMsg = { path: ["endDate"], message: "The end date must be on or after the start date." };

export const idParams = z.object({ id: z.uuid("Not found") });
export const studentParams = z.object({ studentId: z.uuid("Not found") });
export const studentExamParams = z.object({ studentId: z.uuid("Not found"), examId: z.uuid("Not found") });

export const createSchema = z
    .object({
        name: z.string().trim().min(3, "Write the exam name.").max(80),
        shortName: z.string().trim().max(30).nullish(),
        startDate: ymd.nullish(),
        endDate: ymd.nullish(),
        fullMarks: marksInt.default(100),
        passMarks: z.coerce.number().int().min(0).max(500).default(33),
        /** Omit for every active class */
        classIds: z.array(z.uuid()).min(1).max(30).optional(),
    })
    .refine(datesOk, datesMsg)
    .refine((v) => v.passMarks <= v.fullMarks, { path: ["passMarks"], message: "Pass marks cannot be above full marks." });

export const patchSchema = z
    .object({
        name: z.string().trim().min(3).max(80).optional(),
        shortName: z.string().trim().max(30).nullish(),
        startDate: ymd.nullish(),
        endDate: ymd.nullish(),
    })
    .refine(datesOk, datesMsg);

export const subjectsSchema = z.object({
    items: z
        .array(
            z
                .object({ examSubjectId: z.uuid(), fullMarks: marksInt, passMarks: z.coerce.number().int().min(0).max(500), examDate: ymd.nullable().optional(), startTime: hm.nullable().optional() })
                .refine((v) => v.passMarks <= v.fullMarks, { path: ["passMarks"], message: "Pass marks cannot be above full marks." }),
        )
        .min(1)
        .max(200),
});

export const statusSchema = z.object({ status: z.enum(["DRAFT", "MARKS_OPEN", "LOCKED"]) });
export const publishSchema = z.object({ sendSms: z.boolean().default(true), allowIncomplete: z.boolean().default(false) });

export const sheetQuery = z.object({ sectionId: z.uuid(), subjectId: z.uuid() });
export const saveMarksSchema = z.object({
    sectionId: z.uuid(),
    subjectId: z.uuid(),
    rows: z
        .array(
            z.object({
                enrollmentId: z.uuid(),
                obtained: obtained.nullable(),
                absent: z.boolean().default(false),
                remarks: z.string().trim().max(300).nullish(),
            }),
        )
        .min(1)
        .max(200),
});
export const tabulationQuery = z.object({ sectionId: z.uuid() });
