import { prisma } from "#core/prisma.js";
import { url } from "#core/storage.js";

/**
 * Read-only data for the public website, in exactly the shapes of littleflower-front lib/data/types.js.
 * Only published rows; notices are audience PUBLIC only.
 */

const lower = (v) => (v ? String(v).toLowerCase() : v);
const iso = (d) => (d ? d.toISOString() : null);
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : undefined);
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

/** stored image json { path, alt, width, height } → ImageRef { src, alt, width?, height? } */
export const imageRef = (j) => (j?.path ? compact({ src: url(j.path), alt: j.alt ?? "", width: j.width ?? undefined, height: j.height ?? undefined }) : undefined);
const galleryRef = (g) => compact({ src: url(g.path), alt: g.alt ?? "", width: g.width ?? undefined, height: g.height ?? undefined });

const published = () => ({ publishedAt: { not: null, lte: new Date() } });

/* ------------------------------ pages ------------------------------ */

const toPage = (p) => compact({ section: lower(p.section), slug: p.slug, title: p.title, summary: p.summary, cover: imageRef(p.cover), bodyHtml: p.bodyHtml, updatedAt: iso(p.updatedAt) });

/** @param {string} [section] */
export async function listPages(section) {
    const rows = await prisma.page.findMany({ where: { isPublished: true, ...(section && { section: section.toUpperCase() }) }, orderBy: [{ order: "asc" }, { title: "asc" }] });
    return rows.map(toPage);
}

export async function getPage(section, slug) {
    const p = await prisma.page.findUnique({ where: { section_slug: { section: section.toUpperCase(), slug } } });
    return p?.isPublished ? toPage(p) : null;
}

export async function admissionGuide() {
    const rows = await prisma.setting.findMany({ where: { key: { in: ["admission.steps", "admission.documents"] } } });
    const get = (k) => rows.find((r) => r.key === k)?.value;
    return { steps: Array.isArray(get("admission.steps")) ? get("admission.steps") : [], documents: Array.isArray(get("admission.documents")) ? get("admission.documents") : [] };
}

/* ------------------------------ classes ------------------------------ */

export async function listClasses() {
    const rows = await prisma.class.findMany({ orderBy: { order: "asc" } });
    return rows.map((c) => ({ id: c.slug, slug: c.slug, name: c.name, stage: lower(c.stage), order: c.order, gradingMode: c.gradingMode, ageHint: c.ageHint ?? "", tone: lower(c.tone), summary: c.summary ?? "", focus: c.focus ?? [] }));
}

/* ------------------------------ notices ------------------------------ */

const toNotice = (n) => compact({ id: n.id, slug: n.slug, title: n.title, category: lower(n.category), publishedAt: iso(n.publishedAt), pinned: n.pinned, excerpt: n.excerpt, bodyHtml: n.bodyHtml, pdfUrl: url(n.pdfPath) });

/** Pinned first, newest first. @param {{ limit: number, category?: string }} q */
export async function listNotices({ limit, category }) {
    const rows = await prisma.notice.findMany({
        where: { audience: "PUBLIC", ...published(), ...(category && category !== "all" && { category: category.toUpperCase() }) },
        orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
        take: limit,
    });
    return rows.map(toNotice);
}

export async function getNotice(slug) {
    const n = await prisma.notice.findFirst({ where: { slug, audience: "PUBLIC", ...published() } });
    return n ? toNotice(n) : null;
}

/* ------------------------------ news ------------------------------ */

const newsSelect = { id: true, slug: true, title: true, excerpt: true, bodyHtml: true, publishedAt: true, cover: true, images: true, album: { select: { slug: true } } };
const toNews = (n) =>
    compact({
        id: n.id,
        slug: n.slug,
        title: n.title,
        excerpt: n.excerpt,
        bodyHtml: n.bodyHtml,
        publishedAt: iso(n.publishedAt),
        cover: imageRef(n.cover),
        images: Array.isArray(n.images) ? n.images.map(imageRef).filter(Boolean) : undefined,
        albumSlug: n.album?.slug,
    });

export async function listNews({ limit }) {
    const rows = await prisma.newsPost.findMany({ where: published(), orderBy: { publishedAt: "desc" }, take: limit, select: newsSelect });
    return rows.map(toNews);
}

export async function getNewsPost(slug) {
    const n = await prisma.newsPost.findFirst({ where: { slug, ...published() }, select: newsSelect });
    return n ? toNews(n) : null;
}

/* ------------------------------ gallery ------------------------------ */

const albumInclude = { images: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] }, coverImage: true };
const toAlbum = (a) => {
    const images = a.images.map(galleryRef);
    const cover = a.coverImage ? galleryRef(a.coverImage) : images[0];
    return compact({ id: a.id, slug: a.slug, title: a.title, description: a.description, date: ymd(a.date), cover: cover ?? { src: "", alt: "" }, images });
};

export async function listAlbums() {
    const rows = await prisma.galleryAlbum.findMany({ where: { isPublished: true }, orderBy: [{ date: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], include: albumInclude });
    return rows.filter((a) => a.images.length > 0).map(toAlbum);
}

export async function getAlbum(slug) {
    const a = await prisma.galleryAlbum.findUnique({ where: { slug }, include: albumInclude });
    return a?.isPublished && a.images.length ? toAlbum(a) : null;
}

export async function listVideos() {
    const rows = await prisma.video.findMany({ where: { isPublished: true }, orderBy: { order: "asc" } });
    return rows.map((v) => compact({ id: v.id, title: v.title, kind: lower(v.kind), src: url(v.path), poster: url(v.posterPath), youtubeId: v.youtubeId, orientation: lower(v.orientation) }));
}

/* ------------------------------ the rest ------------------------------ */

export async function listStaff() {
    const rows = await prisma.staff.findMany({ where: { showOnWebsite: true, isActive: true }, orderBy: [{ order: "asc" }, { name: "asc" }] });
    return rows.map((s) => compact({ id: s.id, name: s.name, designation: s.designation, qualification: s.qualification, photo: url(s.photoPath), group: lower(s.group), order: s.order }));
}

export async function listFacilities() {
    const rows = await prisma.facility.findMany({ where: { isPublished: true }, orderBy: { order: "asc" } });
    return rows.map((f) => ({ id: f.id, title: f.title, text: f.text, image: imageRef(f.image) ?? { src: "", alt: "" }, tone: lower(f.tone) }));
}

export async function listDownloads() {
    const rows = await prisma.download.findMany({ where: published(), orderBy: { publishedAt: "desc" }, include: { class: { select: { name: true } } } });
    return rows.map((d) => compact({ id: d.id, title: d.title, kind: lower(d.kind).replace("_", "-"), className: d.class?.name, url: url(d.filePath), publishedAt: iso(d.publishedAt) }));
}
