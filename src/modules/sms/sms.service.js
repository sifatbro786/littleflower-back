import { createHash } from "node:crypto";

import { audit } from "#core/audit.js";
import { badRequest, forbidden, notFound } from "#core/errors.js";
import { dhakaDateString } from "#core/dates.js";
import { logger } from "#core/logger.js";
import { prisma } from "#core/prisma.js";
import { getQueue, QUEUES } from "#core/queue.js";
import { can } from "#core/rbac.js";
import { fillTemplate, smsBalance, smsSegments } from "#core/sms.js";

import { listSectionOptions } from "#modules/academics/academics.service.js";
import { studentsWithDues } from "#modules/fees/fees.service.js";
import { guardianRecipients, sectionCounts } from "#modules/students/students.service.js";

/**
 * SMS (PRD §6.9). The API only creates SmsLog rows and queues "sms.send" jobs; the worker talks to
 * the provider (core/sms.js). dedupeKey makes repeats harmless: absent once per student per day,
 * the same bulk message to the same guardian once per day.
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */
const MAX_RECIPIENTS = 2000;
const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/** Creates logs (skipping duplicates) and queues one job per new log. @returns {Promise<number>} queued */
export async function createAndQueue(rows) {
    if (!rows.length) return 0;
    const created = await prisma.smsLog.createManyAndReturn({ data: rows, skipDuplicates: true, select: { id: true } });
    if (created.length) {
        try {
            await getQueue(QUEUES.SMS).addBulk(created.map((r) => ({ name: "sms.send", data: { smsLogId: r.id }, opts: { jobId: `sms_${r.id}` } })));
        } catch (err) {
            logger.error({ err: err.message, count: created.length }, "could not queue SMS (logs stay QUEUED)");
        }
    }
    return created.length;
}

function lastDayOfMonth() {
    const today = dhakaDateString();
    const [y, m] = today.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m, 0)));
}

/**
 * @param {{ audience: { all?: true, sectionId?: string, classId?: string, dues?: true }, body: string, type: string, templateId?: string | null, refId?: string, sentById?: string | null }} opts
 */
export async function queueBulk({ audience, body, type, templateId = null, refId, sentById = null }) {
    let recipients;
    let dues = new Map();
    if (audience.dues) {
        dues = await studentsWithDues();
        recipients = await guardianRecipients({ studentIds: [...dues.keys()] });
    } else if (audience.classId) {
        const sections = (await listSectionOptions()).filter((s) => s.classId === audience.classId);
        recipients = (await Promise.all(sections.map((s) => guardianRecipients({ sectionId: s.value })))).flat();
    } else recipients = await guardianRecipients(audience.sectionId ? { sectionId: audience.sectionId } : { all: true });
    if (recipients.length > MAX_RECIPIENTS) throw badRequest(`That is ${recipients.length} guardians; send to one class at a time (max ${MAX_RECIPIENTS}).`);

    const date = dhakaDateString();
    const dueDate = lastDayOfMonth();
    const rows = recipients
        .filter((r) => r.phone)
        .map((r) => {
            const text = fillTemplate(body, { student_name: r.name, roll: r.roll, class: r.className, date, due_amount: dues.get(r.studentId)?.toLocaleString("en-IN"), due_date: dueDate });
            const seg = smsSegments(text);
            return {
                to: r.phone,
                studentId: r.studentId,
                type,
                templateId,
                body: text,
                segments: seg.segments,
                isUnicode: seg.unicode,
                dedupeKey: `${type}:${r.studentId}:${date}:${refId ?? hash(body)}`,
                sentById,
            };
        });
    const queued = await createAndQueue(rows);
    return { recipients: rows.length, queued, segments: rows.reduce((n, r) => n + r.segments, 0) };
}

/** POST /api/sms/send. sms.dues alone may only send fee reminders to guardians with dues. */
export async function send({ audience, templateId, body }, user, ctx) {
    const tpl = templateId ? await prisma.smsTemplate.findUnique({ where: { id: templateId } }) : null;
    if (templateId && !tpl) throw notFound("Template not found");
    if (!can(user, "sms.send") && (audience !== "dues" || tpl?.type !== "FEE_DUE")) throw forbidden("You can only send fee reminders to guardians with dues.");
    const target = audience === "all" ? { all: true } : audience === "dues" ? { dues: true } : { sectionId: audience };
    const type = audience === "dues" && (!tpl || tpl.type === "FEE_DUE") ? "FEE_DUE" : (tpl?.type ?? "CUSTOM");
    const r = await queueBulk({ audience: target, body, type, templateId: tpl?.id ?? null, sentById: user.id });
    await audit(ctx, { action: "sms.send", entity: "SmsLog", entityId: null, after: { detail: `Queued ${r.queued} SMS (${r.segments} parts) to ${audience === "all" ? "all guardians" : audience === "dues" ? "guardians with dues" : "one class"}` } });
    return r;
}

/** smsOverview() shape for the SMS page. */
export async function overview() {
    const [balance, templates, logs, sections, counts, dues] = await Promise.all([
        smsBalance(),
        prisma.smsTemplate.findMany({ orderBy: { createdAt: "asc" } }),
        prisma.smsLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
        listSectionOptions(),
        sectionCounts(),
        studentsWithDues(),
    ]);
    const ids = [...new Set(logs.map((l) => l.studentId).filter(Boolean))];
    const who = new Map((await guardianRecipients({ studentIds: ids })).map((r) => [r.studentId, r]));
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return {
        balance,
        templates: templates.map((t) => ({ id: t.id, code: t.code, name: t.name, type: t.type, body: t.body, isActive: t.isActive })),
        logs: logs.map((l) => ({
            id: l.id,
            to: l.to,
            type: l.type,
            body: l.body,
            segments: l.segments,
            status: l.status,
            error: l.error,
            sentAt: (l.sentAt ?? l.createdAt).toISOString(),
            studentName: who.get(l.studentId)?.name ?? "—",
            section: who.get(l.studentId)?.className ?? "",
        })),
        audiences: [
            { value: "all", label: "All guardians", count: total },
            ...sections.map((s) => ({ value: s.value, label: `Guardians of ${s.label}`, count: counts.get(s.value) ?? 0 })),
            { value: "dues", label: "Guardians with dues", count: dues.size },
        ],
    };
}

export async function updateTemplate(id, patch, ctx) {
    const t = await prisma.smsTemplate.findUnique({ where: { id } });
    if (!t) throw notFound();
    await prisma.smsTemplate.update({ where: { id }, data: patch });
    await audit(ctx, { action: "sms.template", entity: "SmsTemplate", entityId: id, after: { detail: `Edited SMS template "${patch.name ?? t.name}"` } });
    return (await overview()).templates;
}
