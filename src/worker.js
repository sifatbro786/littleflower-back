import { UnrecoverableError, Worker } from "bullmq";

import { env } from "#config/env.js";
import { logger } from "#core/logger.js";
import { closeMailer } from "#core/mailer.js";
import { disconnectPrisma } from "#core/prisma.js";
import { closeQueues, getQueue, QUEUES } from "#core/queue.js";
import { closeRedis, createRedis } from "#core/redis.js";
import { WORKERS } from "#jobs/registry.js";

/**
 * Background worker process (PM2: separate app, max_memory_restart). Never imported by the API.
 * Each queue gets one Worker; BullMQ opens a blocking connection per Worker (≈2 Redis connections each).
 */
const log = logger.child({ proc: "worker" });
const connections = [];

const workers = Object.entries(WORKERS).map(([queue, { concurrency, processors }]) => {
    const connection = createRedis(`worker:${queue}`, { worker: true });
    connections.push(connection);
    const w = new Worker(
        queue,
        async (job) => {
            const fn = processors[job.name];
            if (!fn) throw new UnrecoverableError(`No processor for ${queue}/${job.name}`);
            return fn(job);
        },
        {
            connection,
            prefix: env.QUEUE_PREFIX,
            concurrency,
            // Lock long enough for a 40-student tabulation PDF; stalled jobs are retried once.
            lockDuration: queue === "pdf" ? 120_000 : 30_000,
            maxStalledCount: 1,
        },
    );
    w.on("completed", (job) => log.info({ queue, job: job.name, id: job.id }, "job done"));
    w.on("failed", (job, err) =>
        log.error({ queue, job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: err.message }, "job failed"),
    );
    w.on("error", (err) => log.error({ queue, err: err.message }, "worker error"));
    return w;
});

log.info({ queues: Object.keys(WORKERS) }, `worker started (${env.NODE_ENV})`);

/**
 * Repeating jobs (BullMQ job schedulers, stored in Redis; upsert is idempotent, so every worker start
 * just re-asserts them). Times are Asia/Dhaka.
 */
const SCHEDULES = [
    { id: "fees-auto-invoice", pattern: "10 6 * * *", name: "fees.autoInvoice" },
    { id: "maintenance-nightly", pattern: "30 3 * * *", name: "maintenance.nightly" },
];
for (const sc of SCHEDULES) {
    getQueue(QUEUES.SYSTEM)
        .upsertJobScheduler(sc.id, { pattern: sc.pattern, tz: "Asia/Dhaka" }, { name: sc.name, data: {} })
        .then(() => log.info({ scheduler: sc.id, pattern: sc.pattern }, "schedule ready"))
        .catch((err) => log.error({ err: err.message, scheduler: sc.id }, "could not register schedule"));
}

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down worker (finishing active jobs)");
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    await Promise.allSettled(workers.map((w) => w.close()));
    closeMailer();
    await Promise.allSettled([closeQueues(), disconnectPrisma(), ...connections.map((c) => c.quit())]);
    await closeRedis();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => log.error({ err }, "unhandledRejection"));
process.on("uncaughtException", (err) => {
    log.fatal({ err }, "uncaughtException");
    process.exit(1);
});
