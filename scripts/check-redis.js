import { env } from "#config/env.js";
import { closeRedis, redis } from "#core/redis.js";

/** npm run check:redis — ping, round trip, version, eviction policy (must be noeviction for BullMQ). */
const r = redis();
try {
    await r.ping();
    const key = `${env.QUEUE_PREFIX}:check:${Date.now()}`;
    await r.set(key, "ok", "EX", 10);
    const back = await r.get(key);
    await r.del(key);
    if (back !== "ok") throw new Error("SET/GET round trip failed");
    console.log("✓ redis ping + set/get ok");

    const info = await r.info();
    const field = (name) => info.match(new RegExp(`^${name}:(.*)$`, "m"))?.[1]?.trim();
    console.log(`  redis ${field("redis_version") ?? "?"}, memory used ${field("used_memory_human") ?? "?"}`);
    const policy = field("maxmemory_policy");
    if (!policy) console.log("! could not read maxmemory_policy (provider hides it); confirm 'No eviction' in the Redis Cloud console");
    else if (policy !== "noeviction") {
        console.error(`✗ maxmemory_policy is "${policy}": BullMQ needs "noeviction" (jobs can silently disappear otherwise)`);
        process.exitCode = 1;
    } else console.log("✓ maxmemory_policy = noeviction");
} catch (err) {
    console.error("✗ redis check failed:", err.message);
    process.exitCode = 1;
} finally {
    await closeRedis();
}
