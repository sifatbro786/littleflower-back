import nodemailer from "nodemailer";

import { env } from "#config/env.js";

/**
 * Nodemailer over SMTP. Only the WORKER sends mail (email queue); the API just enqueues.
 * Port 465 → implicit TLS, anything else → STARTTLS when the server offers it.
 */

/** @type {import("nodemailer").Transporter | undefined} */
let transporter;

export const mailerConfigured = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

export function getTransporter() {
    if (!mailerConfigured()) return null;
    transporter ??= nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 465,
        secure: (env.SMTP_PORT ?? 465) === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        pool: true,
        maxConnections: 2,
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
    });
    return transporter;
}

/** @param {{ to: string, subject: string, text: string, html?: string, replyTo?: string }} msg */
export async function sendMail(msg) {
    const t = getTransporter();
    if (!t) throw new Error("SMTP is not configured");
    return t.sendMail({ from: env.MAIL_FROM || env.SMTP_USER, ...msg });
}

export function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function closeMailer() {
    transporter?.close();
    transporter = undefined;
}
