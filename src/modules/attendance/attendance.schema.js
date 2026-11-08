import { z } from "zod";

const ymd = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Invalid date");
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

export const sheetQuery = z.object({ sectionId: z.uuid(), date: ymd.optional() });
export const saveSchema = z.object({
    sectionId: z.uuid(),
    date: ymd,
    entries: z
        .array(z.object({ enrollmentId: z.uuid(), status: z.enum(["PRESENT", "ABSENT", "LATE"]), note: z.string().trim().max(200).nullish() }))
        .min(1)
        .max(200),
});
export const summaryQuery = z.object({ date: ymd.optional() });
export const trendQuery = z.object({ days: z.coerce.number().int().min(1).max(60).default(14) });
export const datesQuery = z.object({ n: z.coerce.number().int().min(1).max(30).default(6) });
export const reportQuery = z.object({ sectionId: z.uuid(), month: ym });
export const studentMonthQuery = z.object({ month: ym });
export const studentParams = z.object({ studentId: z.uuid("Not found") });
export const holidaySchema = z
    .object({ from: ymd, to: ymd.optional(), title: z.string().trim().min(2, "Write the holiday name.").max(100) })
    .refine((v) => !v.to || v.to >= v.from, { path: ["to"], message: "The end date must be on or after the start date." });
export const holidayParams = z.object({ date: ymd });
