import { env } from "#config/env.js";

import { createApp } from "./app.js";
import { logger } from "#core/logger.js";
import { disconnectPrisma } from "#core/prisma.js";
import { closeQueues } from "#core/queue.js";
import { closeRedis } from "#core/redis.js";

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(`API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
});
// Nginx keepalive is 75s; keep ours longer so Node never closes a socket Nginx is about to reuse.
server.keepAliveTimeout = 76_000;
server.headersTimeout = 77_000;

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down API");
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close();
    server.closeIdleConnections();
    await Promise.allSettled([closeQueues(), disconnectPrisma()]);
    await closeRedis();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection"));
process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaughtException");
    process.exit(1); // PM2 restarts
});
