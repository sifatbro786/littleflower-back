import { z } from "zod";

const ymd = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Invalid date");
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
const taka = z.number().int("Whole taka only").min(0).max(10_000_000);

export const studentParams = z.object({ studentId: z.uuid("Not found") });
export const idParams = z.object({ id: z.uuid("Not found") });
export const paymentsQuery = z.object({ limit: z.coerce.number().int().min(1).max(2000).default(400), from: ymd.optional(), to: ymd.optional() });

export const structureSchema = z.object({
    items: z.array(z.object({ classId: z.uuid(), feeHeadId: z.uuid(), amount: taka })).min(1).max(500),
});

export const generateSchema = z.object({
    month: ym,
    /** Omit for every active MONTHLY head */
    feeHeadIds: z.array(z.uuid()).min(1).max(20).optional(),
    classIds: z.array(z.uuid()).min(1).max(30).optional(),
    dueDate: ymd.nullish(),
});

export const collectSchema = z.object({
    studentId: z.uuid(),
    amount: taka.min(1, "Enter the amount received"),
    method: z.enum(["CASH", "BANK", "BKASH", "NAGAD", "ROCKET", "CARD"]),
    invoiceIds: z.array(z.uuid()).min(1, "Select at least one due").max(60),
    note: z.string().trim().max(200).nullish(),
    /** Random id per collect click; a repeated submit with the same id is rejected */
    clientRef: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

export const reverseSchema = z.object({ reason: z.string().trim().min(5, "Write why this payment is reversed.").max(300) });

export const concessionSchema = z
    .object({
        feeHeadId: z.uuid("Choose a fee."),
        percent: z.number().int().min(1).max(100).nullish(),
        amount: taka.min(1).nullish(),
        reason: z.string().trim().min(3, "Write the reason (e.g. Sibling waiver).").max(120),
    })
    .refine((v) => (v.percent != null) !== (v.amount != null), { path: ["percent"], message: "Give either a percent or a fixed amount." });
