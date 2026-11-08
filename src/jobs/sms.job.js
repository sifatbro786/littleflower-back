import { UnrecoverableError } from "bullmq";

import { dhakaDateString } from "#core/dates.js";
import { prisma } from "#core/prisma.js";
import { fillTemplate, sendSms, smsSegments } from "#core/sms.js";

import { absentees } from "#modules/attendance/attendance.service.js";
import { createAndQueue } from "#modules/sms/sms.service.js";

/** SMS queue processors (3 attempts, exponential backoff: core/queue.js). */
export const smsProcessors = {
    /** @param {import("bullmq").Job<{ smsLogId: string }>} job */
    "sms.send": async (job) => {
        const log = await prisma.smsLog.findUnique({ where: { id: job.data.smsLogId } });
        if (!log) throw new UnrecoverableError("SmsLog not found");
        if (log.status === "SENT" || log.status === "DELIVERED") return { skipped: "already sent" };
        try {
            const { providerId } = await sendSms({ to: log.to, body: log.body });
            await prisma.smsLog.update({ where: { id: log.id }, data: { status: "SENT", providerId, sentAt: new Date(), error: null, attempts: { increment: 1 } } });
            return { providerId };
        } catch (err) {
            const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
            await prisma.smsLog.update({ where: { id: log.id }, data: { status: final ? "FAILED" : "QUEUED", error: String(err.message).slice(0, 500), attempts: { increment: 1 } } });
            throw err;
        }
    },

    /**
     * Runs at the absent cutoff (or right away when saved later). Reads who is STILL absent now,
     * so corrections made before the cutoff send nothing. dedupeKey ABSENT:<student>:<date>.
     * @param {import("bullmq").Job<{ sectionId: string, date: string }>} job
     */
    "absent.section": async (job) => {
        const { sectionId, date } = job.data;
        if (date !== dhakaDateString()) return { skipped: "not today any more" };
        const tpl = await prisma.smsTemplate.findUnique({ where: { code: "absent" } });
        if (!tpl?.isActive) return { skipped: "absent template is off" };
        const list = await absentees(sectionId, date);
        const pretty = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
        const rows = list
            .filter((s) => s.guardianPhone)
            .map((s) => {
                const body = fillTemplate(tpl.body, { student_name: s.name, roll: s.roll, class: s.className, date: pretty });
                const seg = smsSegments(body);
                return { to: s.guardianPhone, studentId: s.studentId, type: "ABSENT", templateId: tpl.id, body, segments: seg.segments, isUnicode: seg.unicode, dedupeKey: `ABSENT:${s.studentId}:${date}` };
            });
        const queued = await createAndQueue(rows);
        return { absent: list.length, queued };
    },
};
