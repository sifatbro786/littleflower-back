import { prisma } from "#core/prisma.js";
import { fillTemplate, smsSegments } from "#core/sms.js";

import { snapshotRecipients } from "#modules/exams/exams.service.js";
import { createAndQueue } from "#modules/sms/sms.service.js";

/** Result queue processors (attempts 1; the SMS rows it creates retry on the SMS queue). */
export const resultProcessors = {
    /**
     * One "result published" SMS per guardian. dedupeKey RESULT:<student>:<exam> makes a re-publish
     * (after an unpublish) or a duplicate job harmless.
     * @param {import("bullmq").Job<{ examId: string }>} job
     */
    "result.notify": async (job) => {
        const tpl = await prisma.smsTemplate.findUnique({ where: { code: "result" } });
        if (!tpl?.isActive) return { skipped: "result template is off" };
        const { exam, rows } = await snapshotRecipients(job.data.examId);
        if (!exam) return { skipped: "exam is not published" };
        const sms = rows
            .filter((r) => r.phone)
            .map((r) => {
                const body = fillTemplate(tpl.body, { student_name: r.name, exam: exam.shortName || exam.name, gpa: r.gpa ?? "N/A", grade: r.grade ?? "" });
                const seg = smsSegments(body);
                return { to: r.phone, studentId: r.studentId, type: "RESULT", templateId: tpl.id, body, segments: seg.segments, isUnicode: seg.unicode, dedupeKey: `RESULT:${r.studentId}:${job.data.examId}` };
            });
        const queued = await createAndQueue(sms);
        return { students: rows.length, queued };
    },
};
