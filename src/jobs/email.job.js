import { UnrecoverableError } from "bullmq";

import { env } from "#config/env.js";
import { escapeHtml, mailerConfigured, sendMail } from "#core/mailer.js";
import { prisma } from "#core/prisma.js";

/**
 * Email queue processors. Each job carries an EmailLog id; the log row records the outcome.
 * Configuration problems (no SMTP, no recipient) fail once without retries.
 */

/** @param {string} id @param {object} data */
const updateLog = (id, data) => prisma.emailLog.update({ where: { id }, data }).catch(() => {});

async function deliver(job, { to, subject, text, html, replyTo }) {
    const { emailLogId } = job.data;
    if (!mailerConfigured() || !to) {
        await updateLog(emailLogId, { status: "FAILED", error: !to ? "No recipient configured" : "SMTP is not configured", attempts: { increment: 1 } });
        throw new UnrecoverableError(!to ? "No recipient configured" : "SMTP is not configured");
    }
    try {
        const info = await sendMail({ to, subject, text, html, replyTo });
        await updateLog(emailLogId, { status: "SENT", to, messageId: info.messageId ?? null, sentAt: new Date(), error: null, attempts: { increment: 1 } });
        return { messageId: info.messageId };
    } catch (err) {
        const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        await updateLog(emailLogId, { status: final ? "FAILED" : "QUEUED", to, error: String(err.message).slice(0, 500), attempts: { increment: 1 } });
        throw err;
    }
}

export const emailProcessors = {
    /** @param {import("bullmq").Job<{ contactMessageId: string, emailLogId: string }>} job */
    "contact.notify": async (job) => {
        const m = await prisma.contactMessage.findUnique({ where: { id: job.data.contactMessageId } });
        if (!m) throw new UnrecoverableError("Contact message not found");
        const rows = [
            ["Name", m.name],
            ["Phone", m.phone ?? "-"],
            ["Email", m.email ?? "-"],
            ["Subject", m.subject ?? "-"],
            ["Message", m.message],
        ];
        return deliver(job, {
            to: env.CONTACT_TO,
            replyTo: m.email || undefined,
            subject: `[Website] ${m.subject ?? "general"} enquiry from ${m.name}`,
            text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
            html: `<table cellpadding="6" style="font-family:Arial,sans-serif;font-size:14px">${rows
                .map(([k, v]) => `<tr><td style="color:#555;vertical-align:top"><b>${k}</b></td><td style="white-space:pre-wrap">${escapeHtml(v)}</td></tr>`)
                .join("")}</table><p style="color:#888;font-size:12px">Sent from the website contact form · IP ${escapeHtml(m.ip ?? "-")}</p>`,
        });
    },
};
