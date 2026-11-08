import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { logger } from "#core/logger.js";
import { prisma } from "#core/prisma.js";
import { ROOT } from "#core/storage.js";

/**
 * Housekeeping shared by the nightly worker job and `npm run uploads:cleanup`.
 *
 * Orphan uploads: files under uploads/{public,private} that no database row references (uploaded
 * in an editor and never saved, or replaced). References are found by scanning whole rows of every
 * table that can hold a stored path, including JSON columns (news cover/images, pages, settings),
 * so a new JSON field is covered automatically. Safety rails: only files older than 24 h; a thumbnail
 * (<id>_t.webp) is kept while its original is referenced; aborts when it would delete more than half
 * of all files (a broken query must never wipe the uploads) unless force is set.
 */
const TABLES = ["Staff", "Student", "Notice", "NewsPost", "Page", "GalleryAlbum", "GalleryImage", "Video", "Facility", "Banner", "Download", "GeneratedDocument", "Setting"];
const STORED = /(?:public|private)\/[a-z]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}(?:_t)?\.(?:webp|pdf)/g;
const DAY = 24 * 3600_000;

async function referencedPaths() {
    const refs = new Set();
    for (const t of TABLES) {
        const rows = await prisma.$queryRawUnsafe(`SELECT row_to_json(x)::text AS j FROM "${t}" x`);
        for (const r of rows) for (const m of r.j.matchAll(STORED)) refs.add(m[0]);
    }
    return refs;
}

async function walk(dir, out = []) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
        if (err.code === "ENOENT") return out;
        throw err;
    }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p, out);
        else if (e.isFile()) out.push(p);
    }
    return out;
}

/** @param {{ dryRun?: boolean, force?: boolean }} [opts] */
export async function cleanupOrphanUploads({ dryRun = false, force = false } = {}) {
    const refs = await referencedPaths();
    const files = [...(await walk(path.join(ROOT, "public"))), ...(await walk(path.join(ROOT, "private")))];
    const now = Date.now();
    const orphans = [];
    for (const abs of files) {
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        if (!/^(public|private)\/[a-z]+\/\d{4}\/\d{2}\//.test(rel)) continue; // only files this app wrote
        const original = rel.replace(/_t\.webp$/, ".webp");
        if (refs.has(rel) || refs.has(original)) continue;
        if (now - (await stat(abs)).mtimeMs < DAY) continue;
        orphans.push({ abs, rel });
    }
    if (!force && !dryRun && files.length >= 10 && orphans.length > files.length / 2) {
        logger.error({ files: files.length, orphans: orphans.length }, "orphan cleanup aborted: would delete more than half of the uploads");
        return { files: files.length, orphans: orphans.length, deleted: 0, aborted: true };
    }
    let deleted = 0;
    if (!dryRun) {
        for (const o of orphans) {
            try {
                await unlink(o.abs);
                deleted++;
            } catch (err) {
                if (err.code !== "ENOENT") logger.warn({ err: err.message, path: o.rel }, "could not delete orphan");
            }
        }
    }
    return { files: files.length, referenced: refs.size, orphans: orphans.length, deleted, sample: orphans.slice(0, 10).map((o) => o.rel) };
}

/** Expired / revoked login and reset tokens older than 30 days (the auth tables stay small). */
export async function pruneTokens() {
    const cutoff = new Date(Date.now() - 30 * DAY);
    const [rt, pr] = await Promise.all([
        prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } }),
        prisma.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] } }),
    ]);
    return { refreshTokens: rt.count, resetTokens: pr.count };
}
