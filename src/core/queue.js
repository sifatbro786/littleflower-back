import { Queue } from "bullmq";

import { env } from "#config/env.js";
import { redis } from "#core/redis.js";

/**
 * BullMQ producers (API side). Workers live in src/worker.js.
 * Job ids double as idempotency keys: adding a job with an existing id is a no-op.
 */
export const QUEUES = Object.freeze({
    SMS: "sms",
    EMAIL: "email",
    PDF: "pdf",
    RESULT: "result",
    SYSTEM: "system",
});

const DAY = 24 * 3600;

/** Retry and retention policy per queue (PRD §10). */
export const QUEUE_DEFAULTS = Object.freeze({
    [QUEUES.SMS]: { attempts: 3, backoff: { type: "exponential", delay: 30_000 } },
    [QUEUES.EMAIL]: { attempts: 5, backoff: { type: "exponential", delay: 30_000 } },
    [QUEUES.PDF]: { attempts: 2, backoff: { type: "fixed", delay: 10_000 } },
    [QUEUES.RESULT]: { attempts: 1 },
    [QUEUES.SYSTEM]: { attempts: 1 },
});

/** Keep Redis small (128 MB on the VPS): completed jobs 1 day / 500, failed 14 days. */
const RETENTION = { removeOnComplete: { age: DAY, count: 500 }, removeOnFail: { age: 14 * DAY } };

/** @type {Map<string, Queue>} */
const queues = new Map();

/** @param {string} name one of QUEUES */
export function getQueue(name) {
    if (!Object.values(QUEUES).includes(name)) throw new Error(`Unknown queue: ${name}`);
    let q = queues.get(name);
    if (!q) {
        q = new Queue(name, {
            connection: redis(),
            prefix: env.QUEUE_PREFIX,
            defaultJobOptions: { ...QUEUE_DEFAULTS[name], ...RETENTION },
        });
        queues.set(name, q);
    }
    return q;
}

/**
 * @param {string} queue  one of QUEUES
 * @param {string} name   job name, e.g. "absent.send"
 * @param {object} data   JSON only (ids, not whole records)
 * @param {import("bullmq").JobsOptions & { jobId?: string }} [opts]  jobId = idempotency key
 */
export function enqueue(queue, name, data, opts = {}) {
    if (opts.jobId) opts = { ...opts, jobId: opts.jobId.replaceAll(":", "_") }; // BullMQ rejects ":" in custom ids
    return getQueue(queue).add(name, data, opts);
}

export async function closeQueues() {
    await Promise.allSettled([...queues.values()].map((q) => q.close()));
    queues.clear();
}
