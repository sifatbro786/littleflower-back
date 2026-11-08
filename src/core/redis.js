import { Redis } from "ioredis";

import { env } from "#config/env.js";
import { logger } from "#core/logger.js";

/**
 * Redis connections. Redis Cloud free allows 30 connections, so the API keeps ONE shared
 * connection (queues + rate limits) and each BullMQ worker gets its own blocking one.
 */

/**
 * @param {string} name
 * @param {{ worker?: boolean }} [opts]
 *   worker: BullMQ workers need maxRetriesPerRequest = null (blocking commands must never give up).
 *   API side: commands wait in the offline queue while (re)connecting, but give up after 3 reconnect
 *   attempts (~3 s), so an HTTP request never hangs on a dead Redis. Health probes add a 2 s timeout.
 */
export function createRedis(name, { worker = false } = {}) {
    const client = new Redis(env.REDIS_URL, {
        connectionName: `${env.APP_SLUG}:${name}`,
        maxRetriesPerRequest: worker ? null : 3,
        retryStrategy: (times) => Math.min(times * 500, 10_000),
    });
    let wasDown = false;
    client.on("error", (err) => {
        if (!wasDown) logger.error({ err: err.message, conn: name }, "redis connection error");
        wasDown = true;
    });
    client.on("ready", () => {
        if (wasDown) logger.info({ conn: name }, "redis reconnected");
        wasDown = false;
    });
    return client;
}

/** @type {Redis | undefined} */
let shared;

/** Shared non-blocking connection for this process. */
export function redis() {
    shared ??= createRedis("shared");
    return shared;
}

export async function closeRedis() {
    if (shared) await shared.quit().catch(() => shared?.disconnect());
    shared = undefined;
}
