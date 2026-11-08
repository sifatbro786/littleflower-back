import { z } from "zod";

export const routineQuery = z.object({ sectionId: z.uuid().optional(), staffId: z.uuid().optional() }).refine((v) => Boolean(v.sectionId) !== Boolean(v.staffId), { message: "Give sectionId or staffId." });
export const todayQuery = z.object({ staffId: z.uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const day = z.enum(["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"]);
export const slotSchema = z.object({
    sectionId: z.uuid(),
    day,
    periodId: z.uuid(),
    /** null clears the cell */
    subjectId: z.uuid().nullable(),
    staffId: z.uuid().nullable().optional(),
});
