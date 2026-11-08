import { QueueEvents } from "bullmq";

import { env } from "#config/env.js";
import { closeQueues, enqueue, QUEUES } from "#core/queue.js";
import { closeRedis, createRedis } from "#core/redis.js";

/** npm run check:queue — needs the worker running (npm run dev:worker in another terminal). */
const conn = createRedis("check-queue-events", { worker: true });
const events = new QueueEvents(QUEUES.SYSTEM, { connection: conn, prefix: env.QUEUE_PREFIX });
try {
    await events.waitUntilReady();
    const job = await enqueue(QUEUES.SYSTEM, "system.ping", { sentAt: new Date().toISOString() });
    const t = performance.now();
    const result = await job.waitUntilFinished(events, 15_000);
    console.log(`✓ worker answered in ${Math.round(performance.now() - t)} ms (pid ${result.pid})`);
} catch (err) {
    const hint = /timed out|before finished/i.test(err.message) ? " — is the worker running? (npm run dev:worker)" : "";
    console.error(`✗ queue check failed: ${err.message}${hint}`);
    process.exitCode = 1;
} finally {
    await events.close();
    await conn.quit();
    await closeQueues();
    await closeRedis();
}
