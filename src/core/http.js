import { env } from "#config/env.js";
import { AppError } from "#core/errors.js";

/**
 * Real client IP. Nginx sits in front (trust proxy = loopback, so req.ip honours X-Forwarded-For
 * from Nginx only). Behind Cloudflare, Nginx must only accept Cloudflare IPs, then CF-Connecting-IP is trusted.
 */
export function clientIp(req, _res, next) {
    const cf = env.BEHIND_CLOUDFLARE ? req.get("cf-connecting-ip") : undefined;
    req.clientIp = cf || req.ip;
    next();
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF guard (PRD §11): state-changing requests must be JSON. Browsers cannot send a cross-site
 * application/json request without a CORS preflight, and the API sends no CORS headers.
 * @param {{ exempt?: RegExp[] }} opts  e.g. multipart uploads, the gateway IPN (form-urlencoded)
 */
export function jsonOnly({ exempt = [] } = {}) {
    return (req, _res, next) => {
        if (!STATE_CHANGING.has(req.method)) return next();
        if (exempt.some((re) => re.test(req.path))) return next();
        // Strict even for empty bodies (e.g. POST /exams/:id/publish): the web client always sends the header.
        const type = (req.get("content-type") || "").toLowerCase();
        if (type.startsWith("application/json")) return next();
        next(new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json"));
    };
}

/** Success envelope: { data } (+ optional meta for pagination). */
export function ok(res, data, { status = 200, meta } = {}) {
    return res.status(status).json(meta ? { data, meta } : { data });
}
