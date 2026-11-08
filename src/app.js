import { randomUUID } from "node:crypto";

import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { authenticate, mustChangePasswordGate } from "#core/auth.js";
import { errorHandler, notFoundHandler } from "#core/errors.js";
import { clientIp, jsonOnly } from "#core/http.js";
import { logger } from "#core/logger.js";
import { ROOT as UPLOAD_ROOT } from "#core/storage.js";
import { apiRouter } from "#modules/index.js";

export function createApp() {
    const app = express();

    app.disable("x-powered-by");
    // Nginx on the same host is the only proxy. Never "true": that would trust a spoofed X-Forwarded-For.
    app.set("trust proxy", "loopback");
    app.set("json replacer", (_k, v) => (typeof v === "bigint" ? Number(v) : v));

    app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-origin" } })); // JSON API; Nginx sets the page CSP
    app.use(
        pinoHttp({
            logger,
            genReqId: (req, res) => {
                const id = req.headers["x-request-id"] || randomUUID();
                res.setHeader("X-Request-Id", id);
                return id;
            },
            autoLogging: { ignore: (req) => req.url === "/api/health" },
            customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
            serializers: {
                req: (req) => ({ id: req.id, method: req.method, url: req.url }),
                res: (res) => ({ statusCode: res.statusCode }),
            },
        }),
    );
    app.use(clientIp);
    app.use(cookieParser());
    app.use(
        jsonOnly({
            exempt: [
                /^\/api\/uploads(\/|$)/, // multipart (Step 2)
                /^\/api\/students\/[^/]+\/photo$/, // multipart student photo (Step 3)
                /^\/api\/payments\/(ipn|success|fail|cancel)$/, // SSLCommerz posts form-urlencoded (Step 4)
            ],
        }),
    );
    app.use(express.json({ limit: "1mb" }));
    app.use(authenticate);
    app.use(mustChangePasswordGate);

    app.use("/api", apiRouter);

    // Public uploads. On the VPS Nginx serves /uploads/public directly (alias, long cache) and this never
    // runs; locally the Next rewrite sends /uploads/* here. Private files are never served statically.
    app.use("/uploads/public", express.static(`${UPLOAD_ROOT}/public`, { dotfiles: "deny", index: false, maxAge: "30d", immutable: true }));

    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
