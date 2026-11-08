import { z } from "zod";

import { STORED_PATH } from "#core/storage.js";

/** An image the client got back from POST /api/uploads (or a seeded /images/... path). */
export const imageInput = z.object({
    path: z.string().regex(STORED_PATH, "Upload the photo again."),
    alt: z.string().trim().max(200).default(""),
    width: z.number().int().positive().max(20000).nullish(),
    height: z.number().int().positive().max(20000).nullish(),
});

const html = z.string().max(100_000, "The text is too long.");
const slug = z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use small letters, numbers and dashes only.")
    .max(100);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.");

export const uuidParams = z.object({ id: z.uuid("Not found") });
export const imageParams = z.object({ id: z.uuid("Not found"), imageId: z.uuid("Not found") });

export const updatePageSchema = z
    .object({
        title: z.string().trim().min(2, "Write a title.").max(150).optional(),
        summary: z.string().trim().min(10, "Write one or two lines (at least 10 characters).").max(300).optional(),
        bodyHtml: html.optional(),
        cover: imageInput.nullable().optional(),
        isPublished: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

const newsFields = {
    title: z.string().trim().min(3, "Write a title.").max(150),
    slug: slug.optional(),
    excerpt: z.string().trim().max(300).optional(),
    bodyHtml: html,
    cover: imageInput,
    /** null = draft; a future time = scheduled */
    publishedAt: z.iso.datetime({ offset: true, message: "Pick a date and time." }).nullable(),
    albumId: z.uuid().nullable().optional(),
};
export const createNewsSchema = z.object(newsFields);
export const updateNewsSchema = z
    .object(Object.fromEntries(Object.entries(newsFields).map(([k, s]) => [k, s.optional()])))
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

const albumFields = {
    title: z.string().trim().min(2, "Write a title.").max(150),
    slug: slug.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    date: ymd.nullable().optional(),
    isPublished: z.boolean().optional(),
};
export const createAlbumSchema = z.object(albumFields);
export const updateAlbumSchema = z
    .object({ ...albumFields, title: albumFields.title.optional(), coverImageId: z.uuid().nullable().optional() })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

export const addImagesSchema = z.object({
    images: z
        .array(imageInput.extend({ thumbPath: z.string().regex(STORED_PATH).nullish() }))
        .min(1)
        .max(50, "Up to 50 photos at a time."),
});
export const updateImageSchema = z.object({ alt: z.string().trim().max(200) });
export const reorderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(1000) });

export const messageSchema = z
    .object({ read: z.boolean().optional(), replied: z.boolean().optional() })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

/* ---------------- 2d: videos, facilities, downloads ---------------- */

/** Accepts a YouTube link (watch, youtu.be, shorts, embed) or a bare 11-character id → the id. */
export const youtubeId = z
    .string()
    .trim()
    .transform((v, ctx) => {
        const m = v.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/) ?? v.match(/^([A-Za-z0-9_-]{11})$/);
        if (!m) ctx.addIssue({ code: "custom", message: "Paste a YouTube link, e.g. https://youtu.be/abc123XYZ_0" });
        return m ? m[1] : v;
    });

const tone = z.enum(["coral", "sun", "sky", "brand"]);
const orientation = z.enum(["landscape", "portrait"]);

export const createVideoSchema = z.object({
    title: z.string().trim().min(2, "Write a title.").max(150),
    youtube: youtubeId,
    orientation: orientation.default("landscape"),
    poster: imageInput.nullable().optional(),
    isPublished: z.boolean().default(true),
});
export const updateVideoSchema = z
    .object({
        title: z.string().trim().min(2, "Write a title.").max(150).optional(),
        youtube: youtubeId.optional(),
        orientation: orientation.optional(),
        poster: imageInput.nullable().optional(),
        isPublished: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

export const createFacilitySchema = z.object({
    title: z.string().trim().min(2, "Write a title.").max(100),
    text: z.string().trim().min(10, "Write one or two lines.").max(400),
    image: imageInput,
    tone: tone.default("brand"),
    isPublished: z.boolean().default(true),
});
export const updateFacilitySchema = z
    .object({
        title: z.string().trim().min(2, "Write a title.").max(100).optional(),
        text: z.string().trim().min(10, "Write one or two lines.").max(400).optional(),
        image: imageInput.optional(),
        tone: tone.optional(),
        isPublished: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

const pdfPath = z.string().regex(/^(public\/(downloads|notices)\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf|\/files\/[\w./-]+\.pdf)$/, "Upload the PDF again.");
const downloadKind = z.enum(["routine", "syllabus", "exam-schedule", "form"]);
export const createDownloadSchema = z.object({
    title: z.string().trim().min(2, "Write a title.").max(150),
    kind: downloadKind,
    classId: z.uuid().nullable().optional(),
    filePath: pdfPath,
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export const updateDownloadSchema = z
    .object({
        title: z.string().trim().min(2, "Write a title.").max(150).optional(),
        kind: downloadKind.optional(),
        classId: z.uuid().nullable().optional(),
        filePath: pdfPath.optional(),
        publishedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
