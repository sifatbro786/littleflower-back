import { createHmac, randomBytes, randomUUID } from "node:crypto";

import argon2 from "argon2";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";

import { env } from "#config/env.js";
import { AppError, unauthorized } from "#core/errors.js";
import { prisma } from "#core/prisma.js";

/**
 * Auth primitives (PRD §11). Login / refresh / logout routes are built on these in the auth module.
 * - access token: 15 min JWT (HS256) in an httpOnly cookie. Claims: sub + role (role is a routing hint
 *   for the Next proxy only; the API always re-reads the user and role from the DB).
 * - refresh token: opaque random string in an httpOnly cookie, stored as an HMAC hash in RefreshToken
 *   with a familyId for rotation and reuse detection. Path is "/" (not /api/auth) because the Next proxy
 *   refreshes server side on page navigations, and the browser only sends a cookie to paths under its Path.
 */

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = { staff: 7, student: 30 };

export const COOKIE = Object.freeze({ ACCESS: `${env.APP_SLUG}_at`, REFRESH: `${env.APP_SLUG}_rt` });

const ISSUER = `${env.APP_SLUG}-api`;
const AUDIENCE = env.APP_SLUG;
const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

/* ------------------------------ passwords ------------------------------ */

// OWASP 2024 argon2id baseline: 19 MiB, t=2, p=1 (~50 ms on the VPS)
const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/** @param {string} plain */
export const hashPassword = (plain) => argon2.hash(plain, ARGON);

let dummyHash;
/**
 * Constant-ish time: an unknown user still costs one argon2 verify, so timing does not reveal accounts.
 * @param {string | null | undefined} hash
 * @param {string} plain
 */
export async function verifyPassword(hash, plain) {
    if (!hash) {
        dummyHash ??= await argon2.hash("not-a-real-password", ARGON);
        await argon2.verify(dummyHash, plain).catch(() => false);
        return false;
    }
    return argon2.verify(hash, plain).catch(() => false);
}

/* ------------------------------ tokens ------------------------------ */

/** @param {{ id: string, role: string }} user  role = Role.key */
export function signAccessToken(user) {
    return new SignJWT({ role: user.role })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(user.id)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setJti(randomUUID())
        .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
        .sign(accessKey);
}

/** @returns {Promise<{ sub: string, role?: string }>} throws AppError(401) */
export async function verifyAccessToken(token) {
    try {
        const { payload } = await jwtVerify(token, accessKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
        return /** @type {{ sub: string, role?: string }} */ (payload);
    } catch (err) {
        if (err instanceof joseErrors.JWTExpired) throw new AppError(401, "TOKEN_EXPIRED", "Session expired");
        throw unauthorized();
    }
}

/** @param {string} token */
export const hashRefreshToken = (token) => createHmac("sha256", env.JWT_REFRESH_SECRET).update(token).digest("base64url");

export function newRefreshToken() {
    const token = randomBytes(32).toString("base64url");
    return { token, tokenHash: hashRefreshToken(token) };
}

/* ------------------------------ cookies ------------------------------ */

const baseCookie = { httpOnly: true, secure: env.isProd, sameSite: /** @type {const} */ ("lax") };

/**
 * @param {import("express").Response} res
 * @param {{ accessToken: string, refreshToken?: string, refreshDays?: number }} t
 */
export function setAuthCookies(res, { accessToken, refreshToken, refreshDays = REFRESH_TTL_DAYS.staff }) {
    res.cookie(COOKIE.ACCESS, accessToken, { ...baseCookie, path: "/", maxAge: ACCESS_TTL_SECONDS * 1000 });
    if (refreshToken) res.cookie(COOKIE.REFRESH, refreshToken, { ...baseCookie, path: "/", maxAge: refreshDays * 86_400_000 });
}

/** @param {import("express").Response} res */
export function clearAuthCookies(res) {
    res.clearCookie(COOKIE.ACCESS, { ...baseCookie, path: "/" });
    res.clearCookie(COOKIE.REFRESH, { ...baseCookie, path: "/" });
}

/* ------------------------------ middleware ------------------------------ */

/**
 * @typedef {Object} AuthUser
 * @property {string} id
 * @property {string} name
 * @property {string} role               Role.key
 * @property {Set<string>} permissions
 * @property {string | null} staffId     for teacher "own" scopes
 * @property {string | null} studentId   for portal "own" scopes
 * @property {boolean} mustChangePassword
 */

/**
 * Reads the access cookie and attaches req.user (or null). Never rejects by itself:
 * routes opt in with requirePermission()/requireAuth. The user row is re-read on every request,
 * so disabling a user or changing a role takes effect immediately (one indexed query).
 */
export async function authenticate(req, _res, next) {
    req.user = null;
    const token = req.cookies?.[COOKIE.ACCESS];
    if (!token) return next();
    let sub;
    try {
        ({ sub } = await verifyAccessToken(token));
    } catch (err) {
        req.authError = err.code === "TOKEN_EXPIRED" ? "expired" : "invalid";
        return next();
    }
    const u = await prisma.user.findUnique({
        where: { id: sub },
        select: {
            id: true,
            name: true,
            status: true,
            mustChangePassword: true,
            role: { select: { key: true, permissions: true } },
            staff: { select: { id: true } },
            student: { select: { id: true } },
        },
    });
    if (!u || u.status !== "ACTIVE") return next();
    /** @type {AuthUser} */
    req.user = {
        id: u.id,
        name: u.name,
        role: u.role.key,
        permissions: new Set(u.role.permissions),
        staffId: u.staff?.id ?? null,
        studentId: u.student?.id ?? null,
        mustChangePassword: u.mustChangePassword,
    };
    next();
}

/** Any signed-in user. */
export function requireAuth(req, _res, next) {
    if (req.user) return next();
    next(req.authError === "expired" ? new AppError(401, "TOKEN_EXPIRED", "Session expired") : unauthorized());
}

/**
 * One-time password gate (admin-created or reset accounts): until the user picks their own password,
 * only /api/auth/* (me, password, refresh, logout) and public endpoints work. Mounted after authenticate.
 */
const OPEN_WHILE_MUST_CHANGE = /^\/api\/(auth|public|contact|health)(\/|$)/;
export function mustChangePasswordGate(req, _res, next) {
    if (req.user?.mustChangePassword && !OPEN_WHILE_MUST_CHANGE.test(req.path)) {
        return next(new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Please choose a new password first."));
    }
    next();
}
