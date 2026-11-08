import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import { env } from "#config/env.js";
import { AppError } from "#core/errors.js";
import { logger } from "#core/logger.js";

/**
 * Local-disk file storage (no cloud). Layout under UPLOAD_DIR (outside the code folder on the VPS):
 *   public/<folder>/<yyyy>/<mm>/<uuid>.webp      served by Nginx at /uploads/public/...
 *   private/<folder>/...                         served only through the API (X-Accel-Redirect, Step 3)
 * The DB stores the relative path ("public/news/2026/11/<uuid>.webp"), never a URL or an absolute path.
 * Seeded Phase 1 content keeps web paths like "/images/x.jpg" (served by Next from public/).
 */

export const ROOT = path.resolve(env.UPLOAD_DIR);

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const IMAGE_FOLDERS = new Set(["news", "pages", "gallery", "facilities", "banners", "staff"]);
/** Folders that must never be public (student photos). */
const PRIVATE_FOLDERS = new Set(["students"]);
const FILE_FOLDERS = new Set(["downloads", "notices"]);

/** Relative paths this app wrote, or seeded web paths. Anything else in a request body is rejected. */
export const STORED_PATH = /^(public\/[a-z]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}(_t)?\.(webp|pdf)|\/(images|videos|files)\/[\w./-]+)$/;

/** Web URL for a stored path. Private files have no direct URL (they go through an API route). */
export function url(p) {
    if (!p) return null;
    if (p.startsWith("/")) return p;
    if (p.startsWith("public/")) return `/uploads/${p}`;
    return null;
}

/** relative ("public/news/...") → absolute, refusing anything that escapes UPLOAD_DIR */
function abs(rel) {
    const a = path.resolve(ROOT, ...rel.split("/"));
    if (!a.startsWith(ROOT + path.sep)) throw new Error(`path escapes upload dir: ${rel}`);
    return a;
}

function newRel(area, folder, ext, suffix = "") {
    const d = new Date();
    const dir = `${area}/${folder}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { dir, name: (id) => `${dir}/${id}${suffix}.${ext}` };
}

async function write(rel, buf) {
    const file = abs(rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buf, { flag: "wx" }); // never overwrite
}

/**
 * Validates by magic bytes (never the file name or Content-Type), auto-rotates, strips metadata
 * (EXIF GPS!), resizes and converts to WebP, plus a thumbnail.
 * @param {Buffer} buffer
 * @param {{ folder: string, area?: "public" | "private", maxSize?: number, thumbSize?: number }} opts
 * @returns {Promise<{ path: string, thumbPath: string, width: number, height: number }>}
 */
export async function storeImage(buffer, { folder, area = "public", maxSize = 2000, thumbSize = 480 }) {
    if (PRIVATE_FOLDERS.has(folder) ? area !== "private" : !IMAGE_FOLDERS.has(folder)) throw new AppError(400, "BAD_REQUEST", "Unknown upload folder");
    const type = await fileTypeFromBuffer(buffer);
    if (!type || !IMAGE_TYPES.has(type.mime)) throw new AppError(415, "UNSUPPORTED_FILE", "Please upload a JPG, PNG or WebP photo.");

    let main, thumb;
    try {
        // limitInputPixels guards against decompression bombs; failOn "error" rejects truncated files.
        const img = sharp(buffer, { failOn: "error", limitInputPixels: 50_000_000, animated: false }).rotate();
        main = await img.clone().resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
        thumb = await img.clone().resize({ width: thumbSize, height: thumbSize, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    } catch (err) {
        logger.warn({ err: err.message }, "image processing failed");
        throw new AppError(415, "UNSUPPORTED_FILE", "This photo could not be read. Please try another file.");
    }

    const id = randomUUID();
    const rel = newRel(area, folder, "webp").name(id);
    const relThumb = newRel(area, folder, "webp", "_t").name(id);
    await write(rel, main.data);
    await write(relThumb, thumb);
    return { path: rel, thumbPath: relThumb, width: main.info.width, height: main.info.height };
}

/**
 * PDF documents (routines, syllabus, notice attachments). Magic-byte checked, stored as-is.
 * @param {Buffer} buffer
 * @param {{ folder: string, area?: "public" | "private" }} opts
 * @returns {Promise<{ path: string, size: number }>}
 */
export async function storePdf(buffer, { folder, area = "public" }) {
    if (!FILE_FOLDERS.has(folder)) throw new AppError(400, "BAD_REQUEST", "Unknown upload folder");
    const type = await fileTypeFromBuffer(buffer);
    if (type?.mime !== "application/pdf") throw new AppError(415, "UNSUPPORTED_FILE", "Please upload a PDF file.");
    const rel = newRel(area, folder, "pdf").name(randomUUID());
    await write(rel, buffer);
    return { path: rel, size: buffer.length };
}

/** Absolute path of a stored relative path (private file streaming in development). */
export const absolutePath = (rel) => abs(rel);

/** Deletes files this app stored (relative paths only; seeded web paths are left alone). Never throws. */
export async function removeStored(...paths) {
    await Promise.all(
        paths
            .filter((p) => typeof p === "string" && (p.startsWith("public/") || p.startsWith("private/")))
            .map((p) =>
                unlink(abs(p)).catch((err) => {
                    if (err.code !== "ENOENT") logger.warn({ err: err.message, path: p }, "could not delete file");
                }),
            ),
    );
}
