import { Router } from "express";
import { z } from "zod";

import { notFound } from "#core/errors.js";
import { ok } from "#core/http.js";
import { validate } from "#core/validate.js";
import { isLoopback, rateLimit } from "#core/rate-limit.js";

import * as pub from "./public.service.js";

/**
 * GET /api/public/* — no auth, read only, published content only. The Next server calls these
 * (lib/live/data.js) and caches them with cacheTag; CMS saves trigger revalidateWeb().
 */
export const publicRouter = Router();

// Crawlers and scrapers: generous for people, the Next server on this machine is never limited.
publicRouter.use(rateLimit({ name: "public:ip", limit: 300, windowSec: 60, skip: isLoopback }));

publicRouter.use((_req, res, next) => {
    res.set("Cache-Control", "public, max-age=60");
    next();
});

const section = z.enum(["about", "academics", "admission", "legal"]);
const slug = z.string().regex(/^[a-z0-9-]{1,120}$/);
const limit = z.coerce.number().int().min(1).max(500).default(50); // sitemap asks for 500
const found = (v) => {
    if (!v) throw notFound();
    return v;
};

publicRouter.get("/pages", validate({ query: z.object({ section: section.optional() }) }), async (req, res) => ok(res, await pub.listPages(req.valid.query.section)));
publicRouter.get("/pages/:section/:slug", validate({ params: z.object({ section, slug }) }), async (req, res) => ok(res, found(await pub.getPage(req.valid.params.section, req.valid.params.slug))));
publicRouter.get("/admission-guide", async (_req, res) => ok(res, await pub.admissionGuide()));
publicRouter.get("/classes", async (_req, res) => ok(res, await pub.listClasses()));

const noticeQuery = z.object({ limit, category: z.enum(["all", "general", "admission", "exam", "holiday", "event"]).optional() });
publicRouter.get("/notices", validate({ query: noticeQuery }), async (req, res) => ok(res, await pub.listNotices(req.valid.query)));
publicRouter.get("/notices/:slug", validate({ params: z.object({ slug }) }), async (req, res) => ok(res, found(await pub.getNotice(req.valid.params.slug))));

publicRouter.get("/news", validate({ query: z.object({ limit }) }), async (req, res) => ok(res, await pub.listNews(req.valid.query)));
publicRouter.get("/news/:slug", validate({ params: z.object({ slug }) }), async (req, res) => ok(res, found(await pub.getNewsPost(req.valid.params.slug))));

publicRouter.get("/albums", async (_req, res) => ok(res, await pub.listAlbums()));
publicRouter.get("/albums/:slug", validate({ params: z.object({ slug }) }), async (req, res) => ok(res, found(await pub.getAlbum(req.valid.params.slug))));
publicRouter.get("/videos", async (_req, res) => ok(res, await pub.listVideos()));

publicRouter.get("/staff", async (_req, res) => ok(res, await pub.listStaff()));
publicRouter.get("/facilities", async (_req, res) => ok(res, await pub.listFacilities()));
publicRouter.get("/downloads", async (_req, res) => ok(res, await pub.listDownloads()));
