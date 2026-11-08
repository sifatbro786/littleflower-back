import { logger } from "#core/logger.js";
import { tx } from "#core/prisma.js";
import { enqueue, QUEUES } from "#core/queue.js";

/**
 * Stores the message first (it is never lost, even with SMTP down), then queues the office email.
 * @param {{ name: string, phone: string, email?: string, subject: string, message: string }} input
 * @param {{ ip: string | null }} ctx
 */
export async function submitContact(input, ctx) {
    const { msg, log } = await tx(async (t) => {
        const msg = await t.contactMessage.create({
            data: { name: input.name, phone: input.phone, email: input.email || null, subject: input.subject, message: input.message, ip: ctx.ip },
            select: { id: true },
        });
        const log = await t.emailLog.create({
            data: { to: "office", subject: `[Website] ${input.subject} enquiry from ${input.name}`, template: "contact.notify" },
            select: { id: true },
        });
        return { msg, log };
    });
    try {
        await enqueue(QUEUES.EMAIL, "contact.notify", { contactMessageId: msg.id, emailLogId: log.id }, { jobId: `contact:${msg.id}` });
    } catch (err) {
        // Redis down: the message is saved and visible in the admin inbox; only the email is missed.
        logger.error({ err: err.message, contactMessageId: msg.id }, "could not queue contact email");
    }
    return { id: msg.id };
}
