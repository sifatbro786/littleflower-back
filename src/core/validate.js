import { badRequest, zodDetails } from "#core/errors.js";

/**
 * Validates body / query / params with zod and puts the parsed values on req.valid.
 * Express 5 makes req.query a getter, so parsed values are never written back onto req.
 *
 * Usage: router.post("/", validate({ body: createNoticeSchema }), handler)
 *
 * @param {{ body?: import("zod").ZodType, query?: import("zod").ZodType, params?: import("zod").ZodType }} schemas
 */
export function validate(schemas) {
    return (req, _res, next) => {
        const valid = {};
        const issues = [];
        for (const part of /** @type {const} */ (["params", "query", "body"])) {
            const schema = schemas[part];
            if (!schema) continue;
            const r = schema.safeParse(req[part] ?? {});
            if (r.success) valid[part] = r.data;
            else issues.push(...zodDetails(r.error).map((d) => ({ ...d, in: part })));
        }
        if (issues.length) return next(badRequest("Invalid request", issues));
        req.valid = valid;
        next();
    };
}
