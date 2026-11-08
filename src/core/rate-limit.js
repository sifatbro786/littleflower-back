import { env } from "#config/env.js";
import { tooMany } from "#core/errors.js";
import { logger } from "#core/logger.js";
import { redis } from "#core/redis.js";

/**
 * Fixed-window rate limiter on Redis (PRD §11). Exact across PM2 restarts; one MULTI per request.
 * Fails OPEN when Redis is down: a limiter outage must not lock every parent out of the portal.
 * Login has a second, DB-backed guard (account lockout), so failing open there is safe.
 */

/**
 * @param {string} key          e.g. "login:ip:1.2.3.4"
 * @param {{ limit: number, windowSec: number }} opts
 * @returns {Promise<{ ok: boolean, count: number, retryAfter: number }>}
 */
export async function hit(key, { limit, windowSec }) {
    const k = `${env.QUEUE_PREFIX}:rl:${key}`;
    try {
        // SET NX EX starts the window atomically, so a key can never be left without a TTL.
        const res = await redis().multi().set(k, 0, "EX", windowSec, "NX").incr(k).ttl(k).exec();
        const count = Number(res?.[1]?.[1] ?? 0);
        const ttl = Number(res?.[2]?.[1] ?? windowSec);
        return { ok: count <= limit, count, retryAfter: ttl > 0 ? ttl : windowSec };
    } catch (err) {
        logger.warn({ err: err.message, key }, "rate limiter unavailable (failing open)");
        return { ok: true, count: 0, retryAfter: 0 };
    }
}

/** Clears a window (e.g. after a successful login). */
export async function resetHits(key) {
    await redis()
        .del(`${env.QUEUE_PREFIX}:rl:${key}`)
        .catch(() => {});
}

/** Requests from this machine (the Next server prerendering pages, the worker). */
export const isLoopback = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.clientIp);

/**
 * Route middleware.
 * @param {{ name: string, limit: number, windowSec: number, key?: (req: import("express").Request) => string, message?: string, skip?: (req: import("express").Request) => boolean }} opts
 */
export function rateLimit({ name, limit, windowSec, key = (req) => req.clientIp, message, skip }) {
    return async (req, res, next) => {
        if (skip?.(req)) return next();
        const r = await hit(`${name}:${key(req)}`, { limit, windowSec });
        if (r.ok) return next();
        res.set("Retry-After", String(r.retryAfter));
        next(tooMany(message));
    };
}
