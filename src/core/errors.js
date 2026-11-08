import { ZodError } from "zod";

import { env } from "#config/env.js";
import { logger } from "#core/logger.js";

/**
 * Error envelope: { error: { code, message, details? } }
 * Services throw AppError (or the helpers below); routes never build error responses themselves.
 */
export class AppError extends Error {
    /**
     * @param {number} status
     * @param {string} code      Stable, machine readable (UPPER_SNAKE)
     * @param {string} message   Safe to show to the user
     * @param {unknown} [details]
     */
    constructor(status, code, message, details) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export const badRequest = (message = "Invalid request", details) => new AppError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Please sign in") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You do not have permission for this") => new AppError(403, "FORBIDDEN", message);
/** Also used for "own scope" misses so ids cannot be probed (PRD §5) */
export const notFound = (message = "Not found") => new AppError(404, "NOT_FOUND", message);
export const conflict = (message = "Conflict", details) => new AppError(409, "CONFLICT", message, details);
export const unprocessable = (message, details) => new AppError(422, "UNPROCESSABLE", message, details);
export const tooMany = (message = "Too many requests, please try again later") => new AppError(429, "TOO_MANY_REQUESTS", message);

/** @param {ZodError} err */
export function zodDetails(err) {
    return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Prisma known request errors → HTTP. Works with and without driver adapters. */
function fromPrisma(err) {
    if (typeof err?.code !== "string" || !/^P\d{4}$/.test(err.code)) return null;
    const meta = err.meta ?? {};
    switch (err.code) {
        case "P2002": {
            // pg adapter gives the index name ("Enrollment_sessionId_sectionId_roll_key"), not the fields
            const cause = meta.driverAdapterError?.cause;
            const fromIndex = cause?.constraint?.index
                ?.replace(new RegExp(`^${cause.table}_`), "")
                .replace(/_key$/, "")
                .split("_");
            const fields = meta.target ?? cause?.constraint?.fields ?? fromIndex;
            return conflict("This record already exists", fields ? { fields: [].concat(fields) } : undefined);
        }
        case "P2003":
            return conflict("This record is linked to other records");
        case "P2025":
            return notFound();
        default:
            return null;
    }
}

export function notFoundHandler(req, _res, next) {
    next(new AppError(404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
    let e = err;
    if (err instanceof ZodError) e = badRequest("Invalid request", zodDetails(err));
    else if (!(err instanceof AppError)) {
        e = fromPrisma(err);
        // body-parser errors
        if (!e && err?.type === "entity.parse.failed") e = badRequest("Malformed JSON body");
        if (!e && err?.type === "entity.too.large") e = new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    }

    if (!e) {
        (req.log ?? logger).error({ err }, "unhandled error");
        e = new AppError(500, "INTERNAL", "Something went wrong");
        if (!env.isProd) e.details = { message: err?.message };
    } else if (e.status >= 500) {
        (req.log ?? logger).error({ err }, e.message);
    }

    if (res.headersSent) return;
    res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details !== undefined && { details: e.details }) } });
}
