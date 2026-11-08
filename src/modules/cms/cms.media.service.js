import { audit } from "#core/audit.js";
import { badRequest, notFound } from "#core/errors.js";
import { prisma, tx } from "#core/prisma.js";
import { revalidateWeb } from "#core/revalidate.js";
import { removeStored, url } from "#core/storage.js";

/**
 * CMS 2d: videos (YouTube; seeded file videos stay editable), facilities, Student Corner downloads.
 * Lists live in GET /api/cms/overview (videos, facilities, downloads, classOptions).
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */

const iso = (d) => (d ? d.toISOString() : null);
const imageJson = (i) => (i ? { path: i.path, alt: i.alt ?? "", width: i.width ?? null, height: i.height ?? null } : null);
const imageOut = (j) => (j?.path ? { path: j.path, url: url(j.path), alt: j.alt ?? "", width: j.width ?? null, height: j.height ?? null } : null);
const upper = (v) => v.toUpperCase().replace("-", "_");

export async function mediaOverview() {
    const [videos, facilities, downloads, classes] = await Promise.all([
        prisma.video.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
        prisma.facility.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
        prisma.download.findMany({ orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }], include: { class: { select: { name: true } } } }),
        prisma.class.findMany({ where: { isActive: true }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
    ]);
    return {
        videos: videos.map((v) => ({
            id: v.id,
            title: v.title,
            kind: v.kind.toLowerCase(),
            youtubeId: v.youtubeId,
            src: url(v.path),
            poster: imageOut(v.posterPath ? { path: v.posterPath } : null),
            orientation: v.orientation.toLowerCase(),
            isPublished: v.isPublished,
        })),
        facilities: facilities.map((f) => ({ id: f.id, title: f.title, text: f.text, image: imageOut(f.image), tone: f.tone.toLowerCase(), isPublished: f.isPublished })),
        downloads: downloads.map((d) => ({ id: d.id, title: d.title, kind: d.kind.toLowerCase().replace("_", "-"), classId: d.classId, className: d.class?.name ?? null, filePath: d.filePath, url: url(d.filePath), publishedAt: iso(d.publishedAt) })),
        classOptions: classes.map((c) => ({ value: c.id, label: c.name })),
    };
}

/* ------------------------------ videos ------------------------------ */

export async function createVideo(input, ctx) {
    const last = await prisma.video.aggregate({ _max: { order: true } });
    const v = await tx(async (t) => {
        const row = await t.video.create({
            data: { title: input.title, kind: "YOUTUBE", youtubeId: input.youtube, orientation: input.orientation.toUpperCase(), posterPath: input.poster?.path ?? null, isPublished: input.isPublished, order: (last._max.order ?? -1) + 1 },
        });
        await audit(ctx, { action: "cms.video.create", entity: "Video", entityId: row.id, after: { detail: `Added video "${input.title}"` } }, t);
        return row;
    });
    await revalidateWeb(["gallery"]);
    return { id: v.id };
}

export async function updateVideo(id, patch, ctx) {
    const cur = await prisma.video.findUnique({ where: { id } });
    if (!cur) throw notFound();
    if (patch.youtube && cur.kind !== "YOUTUBE") throw badRequest("This video is a file on the server; add a new YouTube video instead.");
    await tx(async (t) => {
        await t.video.update({
            where: { id },
            data: {
                ...(patch.title !== undefined && { title: patch.title }),
                ...(patch.youtube !== undefined && { youtubeId: patch.youtube }),
                ...(patch.orientation !== undefined && { orientation: patch.orientation.toUpperCase() }),
                ...(patch.poster !== undefined && { posterPath: patch.poster?.path ?? null }),
                ...(patch.isPublished !== undefined && { isPublished: patch.isPublished }),
            },
        });
        await audit(ctx, { action: "cms.video.update", entity: "Video", entityId: id, after: { detail: `Edited video "${patch.title ?? cur.title}"` } }, t);
    });
    if (patch.poster !== undefined && cur.posterPath !== (patch.poster?.path ?? null)) await removeStored(cur.posterPath);
    await revalidateWeb(["gallery"]);
    return { id };
}

export async function deleteVideo(id, ctx) {
    const cur = await prisma.video.findUnique({ where: { id } });
    if (!cur) throw notFound();
    await tx(async (t) => {
        await t.video.delete({ where: { id } });
        await audit(ctx, { action: "cms.video.delete", entity: "Video", entityId: id, after: { detail: `Deleted video "${cur.title}"` } }, t);
    });
    await removeStored(cur.posterPath, cur.path);
    await revalidateWeb(["gallery"]);
    return { deleted: true };
}

/* ------------------------------ facilities ------------------------------ */

export async function createFacility(input, ctx) {
    const last = await prisma.facility.aggregate({ _max: { order: true } });
    const f = await tx(async (t) => {
        const row = await t.facility.create({ data: { title: input.title, text: input.text, image: imageJson(input.image), tone: input.tone.toUpperCase(), isPublished: input.isPublished, order: (last._max.order ?? -1) + 1 } });
        await audit(ctx, { action: "cms.facility.create", entity: "Facility", entityId: row.id, after: { detail: `Added facility "${input.title}"` } }, t);
        return row;
    });
    await revalidateWeb(["pages"]);
    return { id: f.id };
}

export async function updateFacility(id, patch, ctx) {
    const cur = await prisma.facility.findUnique({ where: { id } });
    if (!cur) throw notFound();
    await tx(async (t) => {
        await t.facility.update({
            where: { id },
            data: {
                ...(patch.title !== undefined && { title: patch.title }),
                ...(patch.text !== undefined && { text: patch.text }),
                ...(patch.image !== undefined && { image: imageJson(patch.image) }),
                ...(patch.tone !== undefined && { tone: patch.tone.toUpperCase() }),
                ...(patch.isPublished !== undefined && { isPublished: patch.isPublished }),
            },
        });
        await audit(ctx, { action: "cms.facility.update", entity: "Facility", entityId: id, after: { detail: `Edited facility "${patch.title ?? cur.title}"` } }, t);
    });
    if (patch.image && cur.image?.path !== patch.image.path) await removeStored(cur.image?.path);
    await revalidateWeb(["pages"]);
    return { id };
}

export async function deleteFacility(id, ctx) {
    const cur = await prisma.facility.findUnique({ where: { id } });
    if (!cur) throw notFound();
    await tx(async (t) => {
        await t.facility.delete({ where: { id } });
        await audit(ctx, { action: "cms.facility.delete", entity: "Facility", entityId: id, after: { detail: `Deleted facility "${cur.title}"` } }, t);
    });
    await removeStored(cur.image?.path);
    await revalidateWeb(["pages"]);
    return { deleted: true };
}

/** Reorder videos or facilities. @param {"video" | "facility"} model */
export async function reorder(model, ids) {
    const delegate = model === "video" ? prisma.video : prisma.facility;
    const existing = new Set((await delegate.findMany({ select: { id: true } })).map((r) => r.id));
    const ordered = ids.filter((i) => existing.has(i));
    await tx(async (t) => {
        const d = model === "video" ? t.video : t.facility;
        for (const [order, id] of ordered.entries()) await d.update({ where: { id }, data: { order } });
    });
    await revalidateWeb([model === "video" ? "gallery" : "pages"]);
    return { reordered: ordered.length };
}

/* ------------------------------ downloads ------------------------------ */

async function assertClass(classId) {
    if (classId && !(await prisma.class.findUnique({ where: { id: classId }, select: { id: true } }))) throw badRequest("Please check the highlighted fields.", [{ path: "classId", message: "Class not found.", in: "body" }]);
}

export async function createDownload(input, ctx) {
    await assertClass(input.classId);
    const d = await tx(async (t) => {
        const row = await t.download.create({ data: { title: input.title, kind: upper(input.kind), classId: input.classId ?? null, filePath: input.filePath, publishedAt: input.publishedAt ? new Date(input.publishedAt) : null } });
        await audit(ctx, { action: "cms.download.create", entity: "Download", entityId: row.id, after: { detail: `Added download "${input.title}"` } }, t);
        return row;
    });
    await revalidateWeb(["downloads"]);
    return { id: d.id };
}

export async function updateDownload(id, patch, ctx) {
    const cur = await prisma.download.findUnique({ where: { id } });
    if (!cur) throw notFound();
    await assertClass(patch.classId);
    await tx(async (t) => {
        await t.download.update({
            where: { id },
            data: {
                ...(patch.title !== undefined && { title: patch.title }),
                ...(patch.kind !== undefined && { kind: upper(patch.kind) }),
                ...(patch.classId !== undefined && { classId: patch.classId }),
                ...(patch.filePath !== undefined && { filePath: patch.filePath }),
                ...(patch.publishedAt !== undefined && { publishedAt: patch.publishedAt ? new Date(patch.publishedAt) : null }),
            },
        });
        await audit(ctx, { action: "cms.download.update", entity: "Download", entityId: id, after: { detail: `Edited download "${patch.title ?? cur.title}"` } }, t);
    });
    if (patch.filePath && patch.filePath !== cur.filePath) await removeStored(cur.filePath);
    await revalidateWeb(["downloads"]);
    return { id };
}

export async function deleteDownload(id, ctx) {
    const cur = await prisma.download.findUnique({ where: { id } });
    if (!cur) throw notFound();
    await tx(async (t) => {
        await t.download.delete({ where: { id } });
        await audit(ctx, { action: "cms.download.delete", entity: "Download", entityId: id, after: { detail: `Deleted download "${cur.title}"` } }, t);
    });
    await removeStored(cur.filePath);
    await revalidateWeb(["downloads"]);
    return { deleted: true };
}
