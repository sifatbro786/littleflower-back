import { env } from "#config/env.js";
import { logger } from "#core/logger.js";

/**
 * SMS provider adapter (PRD §6.9). Only the worker sends. Providers:
 *   log        development default: nothing leaves the server, the message is logged as SENT
 *   bulksmsbd  bulksmsbd.net HTTP API (common in Bangladesh; needs SMS_API_KEY + SMS_SENDER_ID)
 * Add another provider by adding one function here; nothing else changes.
 */

const GSM = /^[\n\r -~£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\[\]~|]*$/;

/** Segments as billed by operators: GSM 160 / 153 per part, Unicode (Bangla) 70 / 67. */
export function smsSegments(text) {
    const unicode = !GSM.test(text);
    const len = [...text].length;
    const [single, multi] = unicode ? [70, 67] : [160, 153];
    return { unicode, segments: len <= single ? 1 : Math.ceil(len / multi) };
}

/** BD mobile 01XXXXXXXXX → 8801XXXXXXXXX (provider format). */
const intl = (to) => (to.startsWith("88") ? to : `88${to}`);

const providers = {
    async log({ to, body }) {
        logger.info({ to, body }, "SMS (log provider, not sent)");
        return { providerId: `log-${Date.now()}` };
    },
    async bulksmsbd({ to, body }) {
        const url = new URL("http://bulksmsbd.net/api/smsapi");
        url.search = new URLSearchParams({ api_key: env.SMS_API_KEY ?? "", type: "text", number: intl(to), senderid: env.SMS_SENDER_ID ?? "", message: body }).toString();
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        const json = await res.json().catch(() => null);
        // 202 = "SMS Submitted Successfully" in their API; anything else is an error code
        if (!res.ok || Number(json?.response_code) !== 202) throw new Error(`bulksmsbd: ${json?.error_message ?? json?.response_code ?? res.status}`);
        return { providerId: String(json?.message_id ?? "") || null };
    },
};

export const smsProviderName = () => (env.SMS_PROVIDER && providers[env.SMS_PROVIDER] ? env.SMS_PROVIDER : "log");

/** @param {{ to: string, body: string }} msg @returns {Promise<{ providerId: string | null }>} */
export function sendSms(msg) {
    return providers[smsProviderName()](msg);
}

/** Remaining balance in taka if the provider reports it, else null. */
export async function smsBalance() {
    if (smsProviderName() !== "bulksmsbd") return null;
    try {
        const res = await fetch(`http://bulksmsbd.net/api/getBalanceApi?api_key=${encodeURIComponent(env.SMS_API_KEY ?? "")}`, { signal: AbortSignal.timeout(5_000) });
        const json = await res.json();
        return typeof json?.balance === "number" ? json.balance : Number(json?.balance) || null;
    } catch {
        return null;
    }
}

/** "{student_name} was absent" + { student_name: "Rafi" } → filled text (unknown variables stay visible). */
export function fillTemplate(body, vars) {
    return body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}
