import pino from "pino";

import { env } from "#config/env.js";

/** One logger for API and worker. Pretty output in development only (pino-pretty is a devDependency). */
export const logger = pino({
    level: env.LOG_LEVEL,
    base: { app: `${env.APP_SLUG}-api` },
    redact: {
        paths: [
            "req.headers.cookie",
            "req.headers.authorization",
            'res.headers["set-cookie"]',
            "*.password",
            "*.passwordHash",
            "*.token",
        ],
        censor: "[redacted]",
    },
    ...(env.isDev && {
        transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,app" } },
    }),
});
