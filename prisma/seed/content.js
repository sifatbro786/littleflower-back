import { toDbDate } from "#core/dates.js";

import { albums, videos } from "./content/gallery.js";
import { downloads, facilities } from "./content/misc.js";
import { news } from "./content/news.js";
import { notices } from "./content/notices.js";
import { admissionDocuments, admissionSteps, pages } from "./content/pages.js";

/**
 * Content seed: the Phase 1 website content (littleflower-front/content) into the CMS tables.
 * Create-if-missing by natural key (slug / section+slug). Tables without a natural key
 * (videos, facilities) are seeded only when empty. Never overwrites edits made in the panel.
 *
 * Image refs keep their Phase 1 web path ("/images/x.jpg", served by Next from public/).
 * New uploads store relative paths ("public/gallery/2026/11/<uuid>.webp"); core/storage url()
 * treats a leading "/" as an existing web path.
 * @param {import("@prisma/client").PrismaClient} prisma
 */
export async function seedContent(prisma) {
    const keep = { update: {} };
    /** content ImageRef → stored image json */
    const imageJson = (i) => (i ? { path: i.src, alt: i.alt ?? "", width: i.width ?? null, height: i.height ?? null } : null);

    for (const [i, p] of pages.entries()) {
        const section = p.section.toUpperCase();
        await prisma.page.upsert({
            where: { section_slug: { section, slug: p.slug } },
            create: { section, slug: p.slug, title: p.title, summary: p.summary, cover: imageJson(p.cover) ?? undefined, bodyHtml: p.bodyHtml.trim(), order: i },
            ...keep,
        });
    }

    for (const n of notices) {
        await prisma.notice.upsert({
            where: { slug: n.slug },
            create: {
                slug: n.slug,
                title: n.title,
                category: n.category.toUpperCase(),
                audience: "PUBLIC",
                excerpt: n.excerpt,
                bodyHtml: n.bodyHtml,
                pdfPath: n.pdfUrl,
                pinned: n.pinned,
                publishedAt: new Date(n.publishedAt),
            },
            ...keep,
        });
    }

    for (const a of albums) {
        const existing = await prisma.galleryAlbum.findUnique({ where: { slug: a.slug }, select: { id: true } });
        if (existing) continue;
        const album = await prisma.galleryAlbum.create({
            data: {
                slug: a.slug,
                title: a.title,
                description: a.description,
                date: a.date ? toDbDate(a.date) : null,
                images: {
                    create: a.images.map((img, order) => ({ path: img.src, alt: img.alt ?? "", width: img.width, height: img.height, order })),
                },
            },
            include: { images: { select: { id: true, path: true } } },
        });
        const cover = album.images.find((img) => img.path === a.cover?.src) ?? album.images[0];
        if (cover) await prisma.galleryAlbum.update({ where: { id: album.id }, data: { coverImageId: cover.id } });
    }

    for (const n of news) {
        const album = n.albumSlug ? await prisma.galleryAlbum.findUnique({ where: { slug: n.albumSlug }, select: { id: true } }) : null;
        await prisma.newsPost.upsert({
            where: { slug: n.slug },
            create: {
                slug: n.slug,
                title: n.title,
                excerpt: n.excerpt,
                bodyHtml: n.bodyHtml.trim(),
                cover: imageJson(n.cover),
                images: n.images?.map(imageJson),
                albumId: album?.id,
                publishedAt: new Date(n.publishedAt),
            },
            ...keep,
        });
    }

    if ((await prisma.video.count()) === 0) {
        await prisma.video.createMany({
            data: videos.map((v, order) => ({
                title: v.title,
                kind: v.kind.toUpperCase(),
                path: v.src,
                posterPath: v.poster,
                youtubeId: v.youtubeId,
                orientation: v.orientation.toUpperCase(),
                order,
            })),
        });
    }

    if ((await prisma.facility.count()) === 0) {
        await prisma.facility.createMany({
            data: facilities.map((f, order) => ({ title: f.title, text: f.text, image: imageJson(f.image), tone: f.tone.toUpperCase(), order })),
        });
    }

    if ((await prisma.download.count()) === 0 && downloads.length) {
        await prisma.download.createMany({
            data: downloads.map((d) => ({ title: d.title, kind: d.kind.toUpperCase().replace("-", "_"), filePath: d.url, publishedAt: new Date(d.publishedAt) })),
        });
    }

    for (const [key, value] of Object.entries({ "admission.steps": admissionSteps, "admission.documents": admissionDocuments })) {
        await prisma.setting.upsert({ where: { key }, create: { key, value }, ...keep });
    }

    console.log(`  content ok (${pages.length} pages, ${notices.length} notices, ${news.length} news, ${albums.length} albums)`);
}
