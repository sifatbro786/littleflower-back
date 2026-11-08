import { Router } from "express";

import { ok } from "#core/http.js";

import { getHealth } from "./health.service.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
    const { healthy, body } = await getHealth();
    res.set("Cache-Control", "no-store");
    ok(res, body, { status: healthy ? 200 : 503 });
});
