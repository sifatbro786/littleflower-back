import { Router } from "express";

import { clearAuthCookies, COOKIE, requireAuth, setAuthCookies } from "#core/auth.js";
import { auditCtx } from "#core/audit.js";
import { ok } from "#core/http.js";
import { rateLimit } from "#core/rate-limit.js";
import { validate } from "#core/validate.js";

import { changePasswordSchema, loginSchema } from "./auth.schema.js";
import * as auth from "./auth.service.js";

export const authRouter = Router();

authRouter.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

const loginLimit = rateLimit({ name: "login:ip", limit: 10, windowSec: 60, message: "Too many attempts. Please wait a minute and try again." });
// The Next proxy refreshes on page loads; a burst of tabs or prefetches is normal, a flood is not.
const refreshLimit = rateLimit({ name: "refresh:ip", limit: 60, windowSec: 60 });

/** POST /api/auth/login  { identifier, password, next? } → { data: { user, redirectTo } } + cookies */
authRouter.post("/login", loginLimit, validate({ body: loginSchema }), async (req, res) => {
    const r = await auth.login(req.valid.body, auditCtx(req));
    setAuthCookies(res, r);
    ok(res, { user: r.user, redirectTo: r.redirectTo });
});

/** POST /api/auth/refresh (gd_rt cookie) → { data: { refreshed: true } } + new cookies; 401 clears both cookies */
authRouter.post("/refresh", refreshLimit, async (req, res) => {
    try {
        const r = await auth.refresh(req.cookies?.[COOKIE.REFRESH], auditCtx(req));
        setAuthCookies(res, { accessToken: r.accessToken, refreshToken: r.refreshToken ?? undefined, refreshDays: r.refreshDays });
        ok(res, { refreshed: true });
    } catch (err) {
        if (err?.status === 401) clearAuthCookies(res);
        throw err;
    }
});

/** POST /api/auth/logout → { data: { loggedOut: true } }; always clears cookies */
authRouter.post("/logout", async (req, res) => {
    await auth.logout(req.cookies?.[COOKIE.REFRESH]);
    clearAuthCookies(res);
    ok(res, { loggedOut: true });
});

/** GET /api/auth/me → { data: CurrentUser } */
authRouter.get("/me", requireAuth, async (req, res) => {
    ok(res, await auth.me(req.user.id));
});

/** POST /api/auth/password { currentPassword, newPassword } → { data: { changed: true } } */
authRouter.post(
    "/password",
    requireAuth,
    rateLimit({ name: "password:user", limit: 5, windowSec: 15 * 60, key: (req) => req.user.id }),
    validate({ body: changePasswordSchema }),
    async (req, res) => {
        await auth.changePassword(req.user.id, req.valid.body, req.cookies?.[COOKIE.REFRESH], auditCtx(req));
        ok(res, { changed: true });
    },
);
