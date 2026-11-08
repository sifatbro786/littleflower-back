import { UnrecoverableError } from "bullmq";

import { env } from "#config/env.js";
import { logger } from "#core/logger.js";

import { autoInvoices, expireIntents } from "#modules/fees/fees.service.js";
import { autoInvoiceDay, enabledModules } from "#modules/settings/settings.service.js";

import { cleanupOrphanUploads, pruneTokens } from "./maintenance.js";

export const systemProcessors = {
    /** Health ping used by `npm run check:queue`. @param {import("bullmq").Job<{ sentAt: string }>} job */
    "system.ping": async (job) => ({ pong: true, sentAt: job.data.sentAt, processedAt: new Date().toISOString(), pid: process.pid }),

    /**
     * POST <WEB_INTERNAL_URL>/internal/revalidate { tags } with the shared secret (littleflower-front app/internal/revalidate).
     * @param {import("bullmq").Job<{ tags: string[] }>} job
     */
    "web.revalidate": async (job) => {
        if (!env.REVALIDATE_SECRET) throw new UnrecoverableError("REVALIDATE_SECRET is not set");
        const res = await fetch(`${env.WEB_INTERNAL_URL}/internal/revalidate`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-revalidate-secret": env.REVALIDATE_SECRET },
            body: JSON.stringify({ tags: job.data.tags }),
            signal: AbortSignal.timeout(5_000),
        });
        if (res.status === 401) throw new UnrecoverableError("Next rejected the revalidate secret (check both .env files)");
        if (!res.ok) throw new Error(`revalidate failed: HTTP ${res.status}`);
        return { tags: job.data.tags };
    },

    /** Daily 06:10 Dhaka (scheduler in worker.js): this month's invoices on fees.autoInvoiceDay. */
    "fees.autoInvoice": async () => {
        if (!(await enabledModules()).includes("fees")) return { skipped: "fees module off" };
        const r = await autoInvoices(await autoInvoiceDay());
        if (r.created) logger.info(r, "monthly invoices generated");
        return r;
    },

    /** Nightly 03:30 Dhaka: orphan uploads, stale checkouts, old auth tokens. Each part fails alone. */
    "maintenance.nightly": async () => {
        const out = {};
        for (const [k, fn] of Object.entries({ uploads: () => cleanupOrphanUploads(), intents: expireIntents, tokens: pruneTokens })) {
            try {
                out[k] = await fn();
            } catch (err) {
                out[k] = { error: err.message };
                logger.error({ err: err.message, part: k }, "nightly maintenance part failed");
            }
        }
        return out;
    },
};
