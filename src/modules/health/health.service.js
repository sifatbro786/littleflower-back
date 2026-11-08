import { prisma } from "#core/prisma.js";
import { redis } from "#core/redis.js";

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

async function probe(fn) {
    const t = performance.now();
    try {
        await withTimeout(fn(), 2_000);
        return { status: "ok", ms: Math.round(performance.now() - t) };
    } catch (err) {
        return { status: "down", error: err.message };
    }
}

/** Used by the uptime monitor (PRD §11): 200 when DB and Redis answer, 503 otherwise. */
export async function getHealth() {
    const [db, cache] = await Promise.all([probe(() => prisma.$queryRaw`SELECT 1`), probe(() => redis().ping())]);
    const healthy = db.status === "ok" && cache.status === "ok";
    return {
        healthy,
        body: { status: healthy ? "ok" : "degraded", db, redis: cache, uptime: Math.round(process.uptime()), time: new Date().toISOString() },
    };
}
