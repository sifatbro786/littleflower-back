import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { AppError } from "#core/errors.js";
import { ok } from "#core/http.js";
import { rateLimit } from "#core/rate-limit.js";
import { requirePermission } from "#core/rbac.js";
import { storeImage, storePdf, url } from "#core/storage.js";
import { validate } from "#core/validate.js";

/**
 * POST /api/uploads?kind=image|pdf&folder=<folder>   multipart/form-data, field "file"
 * → 201 { data: { path, url, thumbPath?, thumbUrl?, width?, height?, size? } }
 * The returned path is then sent in the CMS save (e.g. news cover). Website uploads only for now;
 * private uploads (student photos) arrive with the students module.
 * Exempt from the JSON-only CSRF guard (app.js); SameSite=Lax cookies + no CORS keep it same-origin.
 */
export const uploadsRouter = Router();

const MB = 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * MB, files: 1, fields: 5 } }).single("file");

const query = z.object({
    kind: z.enum(["image", "pdf"]),
    folder: z.enum(["news", "pages", "gallery", "facilities", "banners", "staff", "downloads", "notices"]),
});

uploadsRouter.post(
    "/",
    requirePermission("website.manage"),
    rateLimit({ name: "upload:user", limit: 120, windowSec: 10 * 60, key: (req) => req.user.id, message: "Too many uploads. Please wait a few minutes." }),
    validate({ query }),
    (req, res, next) =>
        upload(req, res, (err) => {
            if (!err) return next();
            if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return next(new AppError(413, "PAYLOAD_TOO_LARGE", "The file is larger than 15 MB."));
            next(new AppError(400, "BAD_REQUEST", "Upload one file in the field \"file\"."));
        }),
    async (req, res) => {
        if (!req.file) throw new AppError(400, "BAD_REQUEST", "No file received.");
        const { kind, folder } = req.valid.query;
        res.set("Cache-Control", "no-store");
        if (kind === "image") {
            if (req.file.size > 10 * MB) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Photos can be up to 10 MB.");
            const img = await storeImage(req.file.buffer, { folder });
            return ok(res, { ...img, url: url(img.path), thumbUrl: url(img.thumbPath) }, { status: 201 });
        }
        const doc = await storePdf(req.file.buffer, { folder });
        ok(res, { ...doc, url: url(doc.path) }, { status: 201 });
    },
);
