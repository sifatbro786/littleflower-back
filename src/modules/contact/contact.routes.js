import { Router } from "express";

import { ok } from "#core/http.js";
import { rateLimit } from "#core/rate-limit.js";
import { validate } from "#core/validate.js";

import { contactSchema } from "./contact.schema.js";
import { submitContact } from "./contact.service.js";

export const contactRouter = Router();

/** POST /api/contact { name, phone, email?, subject, message, website(honeypot) } → { data: { sent: true } } */
contactRouter.post(
    "/",
    rateLimit({ name: "contact:ip", limit: 5, windowSec: 10 * 60, message: "Too many messages. Please try again in a few minutes, or call the office." }),
    (req, res, next) => {
        res.set("Cache-Control", "no-store");
        // Honeypot: real people never fill the hidden "website" field. Pretend success so bots learn nothing.
        if (req.body?.website) return ok(res, { sent: true });
        next();
    },
    validate({ body: contactSchema }),
    async (req, res) => {
        await submitContact(req.valid.body, { ip: req.clientIp ?? null });
        ok(res, { sent: true });
    },
);
