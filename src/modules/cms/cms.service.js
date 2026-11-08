import { Prisma } from "@prisma/client";

import { audit } from "#core/audit.js";
import { conflict, notFound } from "#core/errors.js";
import { prisma, tx } from "#core/prisma.js";
import { revalidateWeb } from "#core/revalidate.js";
import { cleanHtml, plainText } from "#core/sanitize.js";
import { slugify, uniqueSlug } from "#core/slug.js";
import { removeStored, url } from "#core/storage.js";

/**
 * Website CMS writes (PRD §3.3): pages, news, gallery, contact messages. Every save sanitises HTML,
 * writes an audit row and revalidates the matching public cache tags.
 * Website notices are managed by the notices module (Step 3); videos, facilities and downloads in 2d.
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */

const iso = (d) => (d ? d.toISOString() : null);
const imageJson = (i) => (i ? { path: i.path, alt: i.alt ?? "", width: i.width ?? null, height: i.height ?? null } : null);
/** stored json → editor value (path for saving back + url for preview) */
const imageOut = (j) => (j?.path ? { path: j.path, url: url(j.path), alt: j.alt ?? "", width: j.width ?? null, height: j.height ?? null } : null);
const pageHref = (p) => (p.section === "LEGAL" ? `/${p.slug}` : `/${p.section.toLowerCase()}/${p.slug}`);
const dhakaDate = (d) => (d ? d.toISOString().slice(0, 10) : null);

/* ------------------------------ overview ------------------------------ */

/** Shape of littleflower-front lib/dashboard/comms cmsOverview(). */
export async function overview() {
    const [notices, news, albums, pages, messages] = await Promise.all([
        prisma.notice.findMany({ where: { audience: "PUBLIC" }, orderBy: [{ pinned: "desc" }, { publishedAt: { sort: "desc", nulls: "first" } }], take: 200 }),
        prisma.newsPost.findMany({ orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }], take: 200, select: { id: true, title: true, slug: true, publishedAt: true, cover: true } }),
        prisma.galleryAlbum.findMany({ orderBy: [{ date: { sort: "desc", nulls: "first" } }], include: { coverImage: true, images: { take: 1, orderBy: { order: "asc" } }, _count: { select: { images: true } } } }),
        prisma.page.findMany({ orderBy: [{ section: "asc" }, { order: "asc" }] }),
        prisma.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    ]);
    const now = new Date();
    const status = (d) => (!d ? "Draft" : d > now ? "Scheduled" : "Published");
    return {
        notices: notices.map((n) => ({ id: n.id, title: n.title, category: n.category.charAt(0) + n.category.slice(1).toLowerCase(), publishedAt: iso(n.publishedAt), pinned: n.pinned, status: status(n.publishedAt), slug: n.slug })),
        news: news.map((p) => ({ id: p.id, title: p.title, publishedAt: iso(p.publishedAt), slug: p.slug, cover: url(p.cover?.path) ?? "", status: status(p.publishedAt) })),
        albums: albums.map((a) => ({
            id: a.id,
            title: a.title,
            count: a._count.images,
            cover: url((a.coverImage ?? a.images[0])?.thumbPath ?? (a.coverImage ?? a.images[0])?.path) ?? "",
            slug: a.slug,
            date: dhakaDate(a.date),
            isPublished: a.isPublished,
        })),
        pages: pages.map((p) => ({ id: p.id, title: p.title, section: p.section.toLowerCase(), updatedAt: iso(p.updatedAt), href: pageHref(p), isPublished: p.isPublished })),
        messages: messages.map((m) => ({ id: m.id, name: m.name, phone: m.phone ?? "", email: m.email ?? "", subject: m.subject ? m.subject.charAt(0).toUpperCase() + m.subject.slice(1) : "General", message: m.message, receivedAt: iso(m.createdAt), read: Boolean(m.readAt), replied: Boolean(m.repliedAt) })),
    };
}

/* ------------------------------ pages ------------------------------ */

export async function getPage(id) {
    const p = await prisma.page.findUnique({ where: { id } });
    if (!p) throw notFound();
    return { id: p.id, section: p.section.toLowerCase(), slug: p.slug, title: p.title, summary: p.summary, cover: imageOut(p.cover), bodyHtml: p.bodyHtml, isPublished: p.isPublished, updatedAt: iso(p.updatedAt), href: pageHref(p) };
}

/** @param {string} id @param {{ title?: string, summary?: string, bodyHtml?: string, cover?: object | null, isPublished?: boolean }} patch @param {AuditCtx} ctx */
export async function updatePage(id, patch, ctx) {
    const p = await prisma.page.findUnique({ where: { id }, select: { id: true, section: true, slug: true, title: true } });
    if (!p) throw notFound();
    await tx(async (t) => {
        await t.page.update({
            where: { id },
            data: {
                ...(patch.title !== undefined && { title: patch.title }),
                ...(patch.summary !== undefined && { summary: patch.summary }),
                ...(patch.bodyHtml !== undefined && { bodyHtml: cleanHtml(patch.bodyHtml) }),
                ...(patch.cover !== undefined && { cover: patch.cover ? imageJson(patch.cover) : Prisma.DbNull }),
                ...(patch.isPublished !== undefined && { isPublished: patch.isPublished }),
            },
        });
        await audit(ctx, { action: "cms.page.update", entity: "Page", entityId: id, after: { detail: `Edited page ${patch.title ?? p.title}` } }, t);
    });
    await revalidateWeb(["pages", `page:${p.section.toLowerCase()}:${p.slug}`]);
    return getPage(id);
}

/* ------------------------------ news ------------------------------ */

export async function getNews(id) {
    const n = await prisma.newsPost.findUnique({ where: { id } });
    if (!n) throw notFound();
    return { id: n.id, slug: n.slug, title: n.title, excerpt: n.excerpt, bodyHtml: n.bodyHtml, cover: imageOut(n.cover), publishedAt: iso(n.publishedAt), albumId: n.albumId, updatedAt: iso(n.updatedAt) };
}

const newsSlugTaken = (excludeId) => async (s) => Boolean(await prisma.newsPost.findFirst({ where: { slug: s, ...(excludeId && { id: { not: excludeId } }) }, select: { id: true } }));

async function assertAlbum(albumId) {
    if (albumId && !(await prisma.galleryAlbum.findUnique({ where: { id: albumId }, select: { id: true } }))) throw notFound("Album not found");
}

/** @param {any} input @param {AuditCtx} ctx */
export async function createNews(input, ctx) {
    await assertAlbum(input.albumId);
    const slug = input.slug ? (await newsSlugTaken()(input.slug) ? null : input.slug) : await uniqueSlug(slugify(input.title, "news"), newsSlugTaken());
    if (!slug) throw conflict("Another post already uses this web address.", { fields: ["slug"] });
    const bodyHtml = cleanHtml(input.bodyHtml);
    const id = await tx(async (t) => {
        const n = await t.newsPost.create({
            data: {
                slug,
                title: input.title,
                excerpt: input.excerpt || plainText(bodyHtml, 200),
                bodyHtml,
                cover: imageJson(input.cover),
                publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
                albumId: input.albumId ?? null,
            },
            select: { id: true },
        });
        await audit(ctx, { action: "cms.news.create", entity: "NewsPost", entityId: n.id, after: { detail: `Created news "${input.title}"${input.publishedAt ? "" : " (draft)"}` } }, t);
        return n.id;
    });
    await revalidateWeb(["news", `news:${slug}`]);
    return getNews(id);
}

/** @param {string} id @param {any} patch @param {AuditCtx} ctx */
export async function updateNews(id, patch, ctx) {
    const cur = await prisma.newsPost.findUnique({ where: { id }, select: { slug: true, title: true, cover: true } });
    if (!cur) throw notFound();
    await assertAlbum(patch.albumId);
    if (patch.slug && patch.slug !== cur.slug && (await newsSlugTaken(id)(patch.slug))) throw conflict("Another post already uses this web address.", { fields: ["slug"] });
    const bodyHtml = patch.bodyHtml !== undefined ? cleanHtml(patch.bodyHtml) : undefined;
    await tx(async (t) => {
        await t.newsPost.update({
            where: { id },
            data: {
                ...(patch.title !== undefined && { title: patch.title }),
                ...(patch.slug !== undefined && { slug: patch.slug }),
                ...(bodyHtml !== undefined && { bodyHtml }),
                ...(patch.excerpt !== undefined && { excerpt: patch.excerpt || plainText(bodyHtml ?? "", 200) }),
                ...(patch.cover !== undefined && { cover: imageJson(patch.cover) }),
                ...(patch.publishedAt !== undefined && { publishedAt: patch.publishedAt ? new Date(patch.publishedAt) : null }),
                ...(patch.albumId !== undefined && { albumId: patch.albumId }),
            },
        });
        await audit(ctx, { action: "cms.news.update", entity: "NewsPost", entityId: id, after: { detail: `Edited news "${patch.title ?? cur.title}"` } }, t);
    });
    if (patch.cover && cur.cover?.path !== patch.cover.path) await removeStored(cur.cover?.path);
    await revalidateWeb(["news", `news:${cur.slug}`, patch.slug && `news:${patch.slug}`]);
    return getNews(id);
}

export async function deleteNews(id, ctx) {
    const cur = await prisma.newsPost.findUnique({ where: { id }, select: { slug: true, title: true, cover: true, images: true } });
    if (!cur) throw notFound();
    await tx(async (t) => {
        await t.newsPost.delete({ where: { id } });
        await audit(ctx, { action: "cms.news.delete", entity: "NewsPost", entityId: id, after: { detail: `Deleted news "${cur.title}"` } }, t);
    });
    await removeStored(cur.cover?.path, ...(Array.isArray(cur.images) ? cur.images.map((i) => i?.path) : []));
    await revalidateWeb(["news", `news:${cur.slug}`]);
    return { deleted: true };
}

/* ------------------------------ gallery ------------------------------ */

const albumSlugTaken = (excludeId) => async (s) => Boolean(await prisma.galleryAlbum.findFirst({ where: { slug: s, ...(excludeId && { id: { not: excludeId } }) }, select: { id: true } }));
const toDbDate = (ymd) => (ymd ? new Date(`${ymd}T00:00:00Z`) : null);

export async function getAlbum(id) {
    const a = await prisma.galleryAlbum.findUnique({ where: { id }, include: { images: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] } } });
    if (!a) throw notFound();
    return {
        id: a.id,
        slug: a.slug,
        title: a.title,
        description: a.description,
        date: dhakaDate(a.date),
        isPublished: a.isPublished,
        coverImageId: a.coverImageId ?? a.images[0]?.id ?? null,
        images: a.images.map((g) => ({ id: g.id, url: url(g.path), thumbUrl: url(g.thumbPath ?? g.path), alt: g.alt, width: g.width, height: g.height })),
    };
}

/** @param {any} input @param {AuditCtx} ctx */
export async function createAlbum(input, ctx) {
    const slug = input.slug ? ((await albumSlugTaken()(input.slug)) ? null : input.slug) : await uniqueSlug(slugify(input.title, "album"), albumSlugTaken());
    if (!slug) throw conflict("Another album already uses this web address.", { fields: ["slug"] });
    const id = await tx(async (t) => {
        const a = await t.galleryAlbum.create({ data: { slug, title: input.title, description: input.description ?? null, date: toDbDate(input.date), isPublished: input.isPublished ?? true }, select: { id: true } });
        await audit(ctx, { action: "cms.album.create", entity: "GalleryAlbum", entityId: a.id, after: { detail: `Created album "${input.title}"` } }, t);
        return a.id;
    });
    await revalidateWeb(["gallery"]);
    return getAlbum(id);
}

/** @param {string} id @param {any} patch @param {AuditCtx} ctx */
export async function updateAlbum(id, patch, ctx) {
    const cur = await prisma.galleryAlbum.findUnique({ where: { id }, select: { slug: true, title: true } });
    if (!cur) throw notFound();
    if (patch.slug && patch.slug !== cur.slug && (await albumSlugTaken(id)(patch.slug))) throw conflict("Another album already uses this web address.", { fields: ["slug"] });
    if (patch.coverImageId && !(await prisma.galleryImage.findFirst({ where: { id: patch.coverImageId, albumId: id }, select: { id: true } }))) throw notFound("Photo not found in this album");
    await tx(async (t) => {
        await t.galleryAlbum.update({
            where: { id },
            data: {
                ...(patch.title !== undefined && { title: patch.title }),
                ...(patch.slug !== undefined && { slug: patch.slug }),
                ...(patch.description !== undefined && { description: patch.description }),
                ...(patch.date !== undefined && { date: toDbDate(patch.date) }),
                ...(patch.isPublished !== undefined && { isPublished: patch.isPublished }),
                ...(patch.coverImageId !== undefined && { coverImageId: patch.coverImageId }),
            },
        });
        await audit(ctx, { action: "cms.album.update", entity: "GalleryAlbum", entityId: id, after: { detail: `Edited album "${patch.title ?? cur.title}"` } }, t);
    });
    await revalidateWeb(["gallery", `album:${cur.slug}`, patch.slug && `album:${patch.slug}`]);
    return getAlbum(id);
}

export async function deleteAlbum(id, ctx) {
    const cur = await prisma.galleryAlbum.findUnique({ where: { id }, select: { slug: true, title: true, images: { select: { path: true, thumbPath: true } } } });
    if (!cur) throw notFound();
    await tx(async (t) => {
        await t.galleryAlbum.update({ where: { id }, data: { coverImageId: null } });
        await t.galleryAlbum.delete({ where: { id } }); // images cascade
        await audit(ctx, { action: "cms.album.delete", entity: "GalleryAlbum", entityId: id, after: { detail: `Deleted album "${cur.title}" (${cur.images.length} photos)` } }, t);
    });
    await removeStored(...cur.images.flatMap((g) => [g.path, g.thumbPath]));
    await revalidateWeb(["gallery", `album:${cur.slug}`]);
    return { deleted: true };
}

/** Adds uploaded photos at the end of the album. @param {string} id @param {any[]} images @param {AuditCtx} ctx */
export async function addImages(id, images, ctx) {
    const cur = await prisma.galleryAlbum.findUnique({ where: { id }, select: { slug: true, title: true, coverImageId: true } });
    if (!cur) throw notFound();
    await tx(async (t) => {
        const last = await t.galleryImage.aggregate({ where: { albumId: id }, _max: { order: true } });
        const start = (last._max.order ?? -1) + 1;
        await t.galleryImage.createMany({
            data: images.map((g, i) => ({ albumId: id, path: g.path, thumbPath: g.thumbPath ?? null, alt: g.alt ?? "", width: g.width ?? null, height: g.height ?? null, order: start + i })),
        });
        if (!cur.coverImageId) {
            const first = await t.galleryImage.findFirst({ where: { albumId: id }, orderBy: { order: "asc" }, select: { id: true } });
            if (first) await t.galleryAlbum.update({ where: { id }, data: { coverImageId: first.id } });
        }
        await audit(ctx, { action: "cms.album.photos_add", entity: "GalleryAlbum", entityId: id, after: { detail: `Added ${images.length} photo(s) to "${cur.title}"` } }, t);
    });
    await revalidateWeb(["gallery", `album:${cur.slug}`]);
    return getAlbum(id);
}

export async function updateImage(albumId, imageId, { alt }) {
    const g = await prisma.galleryImage.findFirst({ where: { id: imageId, albumId }, select: { album: { select: { slug: true } } } });
    if (!g) throw notFound();
    await prisma.galleryImage.update({ where: { id: imageId }, data: { alt } });
    await revalidateWeb(["gallery", `album:${g.album.slug}`]);
    return getAlbum(albumId);
}

export async function deleteImage(albumId, imageId, ctx) {
    const g = await prisma.galleryImage.findFirst({ where: { id: imageId, albumId }, select: { path: true, thumbPath: true, album: { select: { slug: true, title: true, coverImageId: true } } } });
    if (!g) throw notFound();
    await tx(async (t) => {
        if (g.album.coverImageId === imageId) {
            const next = await t.galleryImage.findFirst({ where: { albumId, id: { not: imageId } }, orderBy: { order: "asc" }, select: { id: true } });
            await t.galleryAlbum.update({ where: { id: albumId }, data: { coverImageId: next?.id ?? null } });
        }
        await t.galleryImage.delete({ where: { id: imageId } });
        await audit(ctx, { action: "cms.album.photo_delete", entity: "GalleryAlbum", entityId: albumId, after: { detail: `Removed a photo from "${g.album.title}"` } }, t);
    });
    await removeStored(g.path, g.thumbPath);
    await revalidateWeb(["gallery", `album:${g.album.slug}`]);
    return getAlbum(albumId);
}

/** ids = the album's photo ids in the new order (ids from other albums are ignored). */
export async function reorderImages(albumId, ids) {
    const a = await prisma.galleryAlbum.findUnique({ where: { id: albumId }, select: { slug: true, images: { select: { id: true } } } });
    if (!a) throw notFound();
    const mine = new Set(a.images.map((g) => g.id));
    const ordered = ids.filter((i) => mine.has(i));
    await tx(async (t) => {
        for (const [order, id] of ordered.entries()) await t.galleryImage.update({ where: { id }, data: { order } });
    });
    await revalidateWeb(["gallery", `album:${a.slug}`]);
    return getAlbum(albumId);
}

/* ------------------------------ messages ------------------------------ */

export async function markMessage(id, { read, replied }, ctx) {
    const m = await prisma.contactMessage.findUnique({ where: { id }, select: { name: true } });
    if (!m) throw notFound();
    const now = new Date();
    await prisma.contactMessage.update({
        where: { id },
        data: {
            ...(read !== undefined && { readAt: read ? now : null }),
            ...(replied !== undefined && { repliedAt: replied ? now : null, ...(replied && { readAt: now }) }),
        },
    });
    if (replied) await audit(ctx, { action: "cms.message.replied", entity: "ContactMessage", entityId: id, after: { detail: `Marked message from ${m.name} as replied` } });
    return { id, read: read ?? replied ?? undefined, replied };
}
