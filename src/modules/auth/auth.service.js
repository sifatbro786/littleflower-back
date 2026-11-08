import { randomUUID } from "node:crypto";

import {
    hashPassword,
    hashRefreshToken,
    newRefreshToken,
    REFRESH_TTL_DAYS,
    signAccessToken,
    verifyPassword,
} from "#core/auth.js";
import { audit, auditQuiet } from "#core/audit.js";
import { AppError, notFound, unauthorized } from "#core/errors.js";
import { normalizeBdPhone } from "#core/phone.js";
import { prisma, tx } from "#core/prisma.js";
import { ROLE_KEYS, STAFF_PERMISSIONS } from "#core/rbac.js";
import { enabledModules } from "#modules/settings/settings.service.js";

/**
 * Login, refresh rotation with reuse detection, logout, current user, password change (PRD §11).
 */

const LOCKOUT = { maxFailures: 5, minutes: 15 };
/**
 * A rotated refresh token presented again within this window is a race (two tabs, parallel page
 * requests through the Next proxy), not theft: answer with a new access token only and keep the family.
 * Later than this, reuse means the old token leaked: revoke the whole family.
 */
const ROTATION_GRACE_MS = 30_000;

const BAD_LOGIN = "Wrong email / student ID or password.";

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */

/** email (has @), BD mobile, else portal username (studentUid, lowercased). */
function whereIdentifier(identifier) {
    const id = identifier.trim().toLowerCase();
    if (id.includes("@")) return { email: id };
    const phone = normalizeBdPhone(id);
    if (phone) return { phone };
    return { username: id };
}

const refreshDaysFor = (roleKey) => (roleKey === ROLE_KEYS.STUDENT ? REFRESH_TTL_DAYS.student : REFRESH_TTL_DAYS.staff);
export const homeFor = (roleKey) => (roleKey === ROLE_KEYS.STUDENT ? "/portal" : "/admin");

/** Only same-site relative paths inside the role's own area (no open redirects). */
function safeNext(next, roleKey) {
    const home = homeFor(roleKey);
    if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return home;
    return next === home || next.startsWith(`${home}/`) || next.startsWith(`${home}?`) ? next : home;
}

/**
 * @param {string} userId
 * @param {string} roleKey
 * @param {AuditCtx} ctx
 * @param {{ familyId?: string, db?: import("@prisma/client").Prisma.TransactionClient }} [opts]
 */
async function issueRefresh(userId, roleKey, ctx, { familyId = randomUUID(), db = prisma } = {}) {
    const days = refreshDaysFor(roleKey);
    const { token, tokenHash } = newRefreshToken();
    const row = await db.refreshToken.create({
        data: {
            userId,
            tokenHash,
            familyId,
            expiresAt: new Date(Date.now() + days * 86_400_000),
            ip: ctx.ip,
            userAgent: ctx.userAgent,
        },
        select: { id: true },
    });
    return { id: row.id, token, days };
}

const revokeFamily = (familyId, db = prisma) =>
    db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });

/**
 * @param {{ identifier: string, password: string, next?: string }} input
 * @param {AuditCtx} ctx
 */
export async function login({ identifier, password, next }, ctx) {
    const user = await prisma.user.findUnique({
        where: whereIdentifier(identifier),
        select: {
            id: true,
            name: true,
            passwordHash: true,
            status: true,
            lockedUntil: true,
            role: { select: { key: true } },
            student: { select: { name: true } },
        },
    });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
        const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
        throw new AppError(429, "ACCOUNT_LOCKED", `Too many wrong passwords. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }

    // Always one argon2 verify, known user or not (timing does not reveal accounts).
    const valid = await verifyPassword(user?.passwordHash, password);

    if (!user || !valid) {
        if (user) {
            const { failedLoginCount } = await prisma.user.update({
                where: { id: user.id },
                data: { failedLoginCount: { increment: 1 } },
                select: { failedLoginCount: true },
            });
            if (failedLoginCount >= LOCKOUT.maxFailures) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT.minutes * 60_000) },
                });
                auditQuiet(ctx, { actorId: user.id, action: "auth.lockout", entity: "User", entityId: user.id });
            }
        }
        throw new AppError(401, "INVALID_CREDENTIALS", BAD_LOGIN);
    }
    if (user.role.key === ROLE_KEYS.STUDENT && !(await enabledModules()).includes("portal")) {
        throw new AppError(403, "MODULE_OFF", "The student portal is not open yet. Please contact the school office.");
    }

    // Checked after the password so a disabled status is never revealed to someone guessing.
    if (user.status !== "ACTIVE") throw new AppError(403, "ACCOUNT_DISABLED", "This account is disabled. Please contact the school office.");

    const roleKey = user.role.key;
    const [refresh] = await Promise.all([
        issueRefresh(user.id, roleKey, ctx),
        prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } }),
    ]);
    auditQuiet(ctx, { actorId: user.id, action: "auth.login", entity: "User", entityId: user.id });

    return {
        accessToken: await signAccessToken({ id: user.id, role: roleKey }),
        refreshToken: refresh.token,
        refreshDays: refresh.days,
        user: { id: user.id, name: user.student?.name ?? user.name, role: roleKey },
        redirectTo: safeNext(next, roleKey),
    };
}

/**
 * Rotates the refresh token. Returns refreshToken: null on the grace path (the caller keeps the
 * cookie the browser already received from the winning request).
 * @param {string | undefined} raw  <APP_SLUG>_rt cookie
 * @param {AuditCtx} ctx
 */
export async function refresh(raw, ctx) {
    if (!raw) throw unauthorized();
    const row = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(raw) },
        select: {
            id: true,
            userId: true,
            familyId: true,
            expiresAt: true,
            revokedAt: true,
            replacedById: true,
            user: { select: { status: true, role: { select: { key: true } } } },
        },
    });
    if (!row || row.expiresAt <= new Date()) throw unauthorized();

    const roleKey = row.user.role.key;
    if (row.user.status !== "ACTIVE") {
        await revokeFamily(row.familyId);
        throw unauthorized();
    }

    const graceAccess = async () => ({
        accessToken: await signAccessToken({ id: row.userId, role: roleKey }),
        refreshToken: null,
        refreshDays: refreshDaysFor(roleKey),
    });

    if (row.revokedAt) {
        if (row.replacedById && Date.now() - row.revokedAt.getTime() < ROTATION_GRACE_MS) {
            // Only while the family is still alive: after logout or a password change, no grace.
            const successor = await prisma.refreshToken.findUnique({ where: { id: row.replacedById }, select: { revokedAt: true } });
            if (successor && !successor.revokedAt) return graceAccess();
            throw unauthorized();
        }
        // Reuse of a token that was rotated (or revoked) earlier: assume theft, end every session of this login.
        await revokeFamily(row.familyId);
        auditQuiet(ctx, { actorId: row.userId, action: "auth.token_reuse", entity: "RefreshToken", entityId: row.familyId });
        throw unauthorized();
    }

    try {
        const next = await tx(async (t) => {
            const created = await issueRefresh(row.userId, roleKey, ctx, { familyId: row.familyId, db: t });
            // Conditional update: two concurrent refreshes with the same token, only one wins.
            const { count } = await t.refreshToken.updateMany({
                where: { id: row.id, revokedAt: null },
                data: { revokedAt: new Date(), replacedById: created.id },
            });
            if (count !== 1) throw new RotationRace();
            return created;
        });
        return {
            accessToken: await signAccessToken({ id: row.userId, role: roleKey }),
            refreshToken: next.token,
            refreshDays: next.days,
        };
    } catch (err) {
        if (err instanceof RotationRace) return graceAccess();
        throw err;
    }
}

class RotationRace extends Error {}

/** Revokes the whole family of the presented refresh token (this device's login). Never throws for bad tokens. */
export async function logout(raw) {
    if (!raw) return;
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(raw) }, select: { familyId: true } });
    if (row) await revokeFamily(row.familyId);
}

/**
 * The signed-in user in the shape littleflower-front expects (lib/auth/session getCurrentUser):
 * { id, name, role, roleName, permissions, title?, staffId?, studentId?, identifier, mustChangePassword }
 * @param {string} userId
 */
export async function me(userId) {
    const u = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            username: true,
            mustChangePassword: true,
            role: { select: { key: true, name: true, permissions: true } },
            staff: { select: { id: true, designation: true } },
            student: { select: { id: true, name: true, studentUid: true } },
        },
    });
    if (!u) throw notFound();
    const isSuper = u.role.key === ROLE_KEYS.SUPER_ADMIN;
    return {
        id: u.id,
        name: u.student?.name ?? u.name,
        role: u.role.key,
        roleName: u.role.name,
        permissions: isSuper ? STAFF_PERMISSIONS : u.role.permissions,
        title: u.staff?.designation ?? null,
        staffId: u.staff?.id ?? null,
        studentId: u.student?.id ?? null,
        identifier: u.student?.studentUid ?? u.email ?? u.phone ?? u.username ?? "",
        mustChangePassword: u.mustChangePassword,
        modules: await enabledModules(),
    };
}

/**
 * Changes the password and signs out every OTHER device (other refresh families).
 * @param {string} userId
 * @param {{ currentPassword: string, newPassword: string }} input
 * @param {string | undefined} currentRaw  this device's refresh cookie (its family survives)
 * @param {AuditCtx} ctx
 */
export async function changePassword(userId, { currentPassword, newPassword }, currentRaw, ctx) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!u || !(await verifyPassword(u.passwordHash, currentPassword))) {
        throw new AppError(400, "BAD_REQUEST", "Please check the highlighted fields.", [{ path: "currentPassword", message: "Current password is not correct.", in: "body" }]);
    }
    const passwordHash = await hashPassword(newPassword);
    const keepFamily = currentRaw
        ? (await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(currentRaw) }, select: { familyId: true } }))?.familyId
        : undefined;

    await tx(async (t) => {
        await t.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false } });
        await t.refreshToken.updateMany({
            where: { userId, revokedAt: null, ...(keepFamily && { familyId: { not: keepFamily } }) },
            data: { revokedAt: new Date() },
        });
        await audit(ctx, { action: "auth.password_change", entity: "User", entityId: userId }, t);
    });
}
