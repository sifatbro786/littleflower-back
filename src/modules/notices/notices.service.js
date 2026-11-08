import { audit } from "#core/audit.js";
import { badRequest, notFound } from "#core/errors.js";
import { prisma, tx } from "#core/prisma.js";
import { can } from "#core/rbac.js";
import { revalidateWeb } from "#core/revalidate.js";
import { cleanHtml, plainText } from "#core/sanitize.js";
import { slugify, uniqueSlug } from "#core/slug.js";
import { removeStored, url } from "#core/storage.js";

import { currentEnrollment } from "#modules/students/students.service.js";
import { queueBulk } from "#modules/sms/sms.service.js";

/**
 * Notices (PRD §6.9): one table, audience PUBLIC (website) / ALL (staff + guardians) / STAFF / CLASS.
 * PUBLIC notices revalidate the website. Optional SMS to guardians for ALL / CLASS.
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */

const iso = (d) => (d ? d.toISOString() : null);
const audienceKey = (n) => (n.audience === "CLASS" ? `CLASS:${n.classId}` : n.audience);
const statusOf = (d) => (!d ? "Draft" : d > new Date() ? "Scheduled" : "Published");
const toItem = (n) => ({
    id: n.id,
    slug: n.slug,
    title: n.title,
    audience: audienceKey(n),
    classId: n.classId,
    className: n.class?.name ?? null,
    category: n.category,
    publishedAt: iso(n.publishedAt),
    status: statusOf(n.publishedAt),
    pinned: n.pinned,
    body: plainText(n.bodyHtml ?? n.excerpt ?? "", 600),
    bodyHtml: n.bodyHtml ?? "",
    pdfPath: n.pdfPath,
    pdfUrl: url(n.pdfPath),
});

const published = () => ({ publishedAt: { not: null, lte: new Date() } });
const order = [{ pinned: "desc" }, { publishedAt: { sort: "desc", nulls: "first" } }];

/**
 * Staff list. notices.manage sees everything (drafts, scheduled, website); other staff see published
 * STAFF / ALL / CLASS notices (optionally one class).
 */
export async function listStaffNotices({ classId } = {}, user) {
    const manage = user ? can(user, "notices.manage") : false;
    const rows = await prisma.notice.findMany({
        where: manage ? {} : { ...published(), OR: [{ audience: { in: ["STAFF", "ALL"] } }, { audience: "CLASS", ...(classId && { classId }) }] },
        orderBy: order,
        take: 300,
        include: { class: { select: { name: true } } },
    });
    return rows.map(toItem);
}

/** Guardian portal: school-wide + own class + website notices, newest first. */
export async function portalNotices(studentId) {
    const en = await currentEnrollment(studentId);
    if (!en) throw notFound();
    const rows = await prisma.notice.findMany({
        where: { ...published(), OR: [{ audience: { in: ["ALL", "PUBLIC"] } }, { audience: "CLASS", classId: en.section.class.id }] },
        orderBy: { publishedAt: "desc" },
        take: 100,
    });
    return rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: plainText(n.bodyHtml ?? n.excerpt ?? "", 600),
        publishedAt: iso(n.publishedAt),
        scope: n.audience === "PUBLIC" ? "Website" : n.audience === "CLASS" ? "Your class" : "School",
        pinned: n.pinned,
        ...(n.audience === "PUBLIC" && { slug: n.slug }),
        pdfUrl: url(n.pdfPath),
    }));
}

const slugTaken = (excludeId) => async (s) => Boolean(await prisma.notice.findFirst({ where: { slug: s, ...(excludeId && { id: { not: excludeId } }) }, select: { id: true } }));

async function assertClass(classId) {
    if (classId && !(await prisma.class.findUnique({ where: { id: classId }, select: { id: true } }))) throw badRequest("Please check the highlighted fields.", [{ path: "classId", message: "Class not found.", in: "body" }]);
}

/** SMS the notice title to guardians when it is visible now (ALL / CLASS). Returns the queued count. */
async function maybeSms(notice, sendSms, userId) {
    if (!sendSms || !["ALL", "CLASS"].includes(notice.audience) || !notice.publishedAt || notice.publishedAt > new Date()) return 0;
    const body = `${notice.title} - see the school portal for details.`;
    const r = await queueBulk({ audience: notice.audience === "CLASS" ? { classId: notice.classId } : { all: true }, body, type: "CUSTOM", refId: `notice:${notice.id}`, sentById: userId });
    return r.queued;
}

export async function createNotice(input, ctx) {
    await assertClass(input.classId);
    const slug = await uniqueSlug(slugify(input.title, "notice"), slugTaken());
    const bodyHtml = cleanHtml(input.bodyHtml);
    const n = await tx(async (t) => {
        const row = await t.notice.create({
            data: {
                slug,
                title: input.title,
                bodyHtml,
                excerpt: plainText(bodyHtml, 200) || null,
                audience: input.audience,
                classId: input.audience === "CLASS" ? input.classId : null,
                category: input.category,
                pinned: input.pinned,
                publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
                pdfPath: input.pdfPath ?? null,
                createdById: ctx.actorId,
            },
        });
        await audit(ctx, { action: "notice.create", entity: "Notice", entityId: row.id, after: { detail: `Posted notice "${input.title}" (${audienceKey(row)})` } }, t);
        return row;
    });
    if (n.audience === "PUBLIC") await revalidateWeb(["notices", `notice:${n.slug}`]);
    const smsQueued = await maybeSms(n, input.sendSms, ctx.actorId);
    return { ...toItem(n), smsQueued };
}

export async function updateNotice(id, patch, ctx) {
    const cur = await prisma.notice.findUnique({ where: { id } });
    if (!cur) throw notFound();
    await assertClass(patch.classId);
    const audience = patch.audience ?? cur.audience;
    const bodyHtml = patch.bodyHtml !== undefined ? cleanHtml(patch.bodyHtml) : undefined;
    const n = await tx(async (t) => {
        const row = await t.notice.update({
            where: { id },
            data: {
                ...(patch.title !== undefined && { title: patch.title }),
                ...(bodyHtml !== undefined && { bodyHtml, excerpt: plainText(bodyHtml, 200) || null }),
                ...(patch.audience !== undefined && { audience }),
                ...((patch.audience !== undefined || patch.classId !== undefined) && { classId: audience === "CLASS" ? (patch.classId ?? cur.classId) : null }),
                ...(patch.category !== undefined && { category: patch.category }),
                ...(patch.pinned !== undefined && { pinned: patch.pinned }),
                ...(patch.publishedAt !== undefined && { publishedAt: patch.publishedAt ? new Date(patch.publishedAt) : null }),
                ...(patch.pdfPath !== undefined && { pdfPath: patch.pdfPath }),
            },
        });
        await audit(ctx, { action: "notice.update", entity: "Notice", entityId: id, after: { detail: `Edited notice "${row.title}"` } }, t);
        return row;
    });
    if (patch.pdfPath !== undefined && patch.pdfPath !== cur.pdfPath) await removeStored(cur.pdfPath);
    if (cur.audience === "PUBLIC" || n.audience === "PUBLIC") await revalidateWeb(["notices", `notice:${n.slug}`]);
    const smsQueued = await maybeSms(n, patch.sendSms, ctx.actorId);
    return { ...toItem(n), smsQueued };
}

export async function deleteNotice(id, ctx) {
    const cur = await prisma.notice.findUnique({ where: { id } });
    if (!cur) throw notFound();
    await tx(async (t) => {
        await t.notice.delete({ where: { id } });
        await audit(ctx, { action: "notice.delete", entity: "Notice", entityId: id, after: { detail: `Deleted notice "${cur.title}"` } }, t);
    });
    await removeStored(cur.pdfPath);
    if (cur.audience === "PUBLIC") await revalidateWeb(["notices", `notice:${cur.slug}`]);
    return { deleted: true };
}
