import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.");
export const idParams = z.object({ id: z.uuid("Not found") });

export const createSessionSchema = z
    .object({
        name: z.string().trim().min(4, "e.g. 2027").max(20),
        startDate: ymd,
        endDate: ymd,
        /** Copy class teachers and subject teachers from the current session */
        copyTeachers: z.boolean().default(true),
    })
    .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: "The end date must be after the start date." });

const gradingMode = z.enum(["MARKS", "REMARKS"]);
const tone = z.enum(["coral", "sun", "sky", "brand"]);

export const createClassSchema = z.object({
    name: z.string().trim().min(2, "Write the class name.").max(40),
    stage: z.enum(["early", "primary", "secondary"]),
    gradingMode,
    sections: z.array(z.string().trim().min(1).max(20)).min(1).max(10).default(["A"]),
});

export const updateClassSchema = z
    .object({
        name: z.string().trim().min(2).max(40).optional(),
        gradingMode: gradingMode.optional(),
        ageHint: z.string().trim().max(60).nullable().optional(),
        summary: z.string().trim().max(400).nullable().optional(),
        focus: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
        tone: tone.optional(),
        isActive: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

export const sectionSchema = z.object({ name: z.string().trim().min(1, "Write a section name.").max(20) });
export const classTeacherSchema = z.object({ staffId: z.uuid().nullable() });

export const createSubjectSchema = z.object({
    name: z.string().trim().min(2, "Write the subject name.").max(60),
    code: z.string().trim().max(12).nullable().optional(),
});
export const updateSubjectSchema = z
    .object({
        name: z.string().trim().min(2).max(60).optional(),
        code: z.string().trim().max(12).nullable().optional(),
        isActive: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
export const orderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100) });

export const assignmentsSchema = z.object({
    items: z.array(z.object({ subjectId: z.uuid(), staffId: z.uuid().nullable() })).max(50),
});
