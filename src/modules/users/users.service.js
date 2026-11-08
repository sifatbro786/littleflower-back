import { hashPassword } from "#core/auth.js";
import { audit } from "#core/audit.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "#core/errors.js";
import { tempPassword } from "#core/password.js";
import { prisma, tx } from "#core/prisma.js";
import { holdsAll, ROLE_KEYS, STAFF_PERMISSIONS } from "#core/rbac.js";

/**
 * Staff accounts (PRD §5). Student / guardian portal accounts belong to the students module (Step 3):
 * this module never lists, edits or assigns the STUDENT role.
 *
 * Guards (no privilege escalation):
 * - only a Super Admin can touch Super Admin accounts or assign the Super Admin role
 * - a non-Super-Admin can only assign roles whose permissions they hold, and only manage users whose
 *   current role is within their own permissions
 * - nobody changes their own role or disables themselves; at least one active Super Admin always remains
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */
/** @typedef {import("#core/auth.js").AuthUser} AuthUser */

const NOT_STUDENT = { role: { key: { not: ROLE_KEYS.STUDENT } } };

const rolePerms = (role) => (role.key === ROLE_KEYS.SUPER_ADMIN ? STAFF_PERMISSIONS : role.permissions);
const isLocked = (u) => Boolean(u.lockedUntil && u.lockedUntil > new Date());

const listSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    username: true,
    status: true,
    lastLoginAt: true,
    lockedUntil: true,
    role: { select: { id: true, key: true, name: true } },
};

/** Row shape of littleflower-front lib/dashboard/users listUsers(). */
const toRow = (u) => ({
    id: u.id,
    name: u.name,
    login: u.email ?? u.phone ?? u.username ?? "",
    role: u.role.key,
    roleName: u.role.name,
    status: u.status,
    locked: isLocked(u),
    lastLogin: u.lastLoginAt?.toISOString() ?? null,
});

/** @param {{ q?: string, roleId?: string, status?: "ACTIVE" | "DISABLED" }} f */
export async function listUsers(f = {}) {
    const users = await prisma.user.findMany({
        where: {
            ...NOT_STUDENT,
            ...(f.roleId && { roleId: f.roleId }),
            ...(f.status && { status: f.status }),
            ...(f.q && {
                OR: [
                    { name: { contains: f.q, mode: "insensitive" } },
                    { email: { contains: f.q.toLowerCase() } },
                    { phone: { contains: f.q } },
                ],
            }),
        },
        select: listSelect,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        take: 1000,
    });
    return users.map(toRow);
}

/** @param {string} id */
export async function getUser(id) {
    const u = await prisma.user.findFirst({
        where: { id, ...NOT_STUDENT },
        select: {
            ...listSelect,
            mustChangePassword: true,
            passwordChangedAt: true,
            createdAt: true,
            staff: { select: { id: true, name: true, designation: true } },
        },
    });
    if (!u) throw notFound();
    return {
        ...toRow(u),
        email: u.email,
        phone: u.phone,
        roleId: u.role.id,
        mustChangePassword: u.mustChangePassword,
        passwordChangedAt: u.passwordChangedAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        staff: u.staff,
    };
}

/* ------------------------------ guards ------------------------------ */

/** @param {AuthUser} actor @param {{ key: string, permissions: string[] }} role */
function assertCanAssign(actor, role) {
    if (role.key === ROLE_KEYS.STUDENT) throw badRequest("Portal accounts are managed from the student's profile.");
    if (role.key === ROLE_KEYS.SUPER_ADMIN && actor.role !== ROLE_KEYS.SUPER_ADMIN) throw forbidden("Only a Super Admin can assign the Super Admin role.");
    if (!holdsAll(actor, rolePerms(role))) throw forbidden("You cannot give a role with permissions you do not have yourself.");
}

/** @param {AuthUser} actor @param {{ id: string, role: { key: string, permissions: string[] } }} target */
function assertCanManage(actor, target) {
    if (target.role.key === ROLE_KEYS.SUPER_ADMIN && actor.role !== ROLE_KEYS.SUPER_ADMIN) throw forbidden("Only a Super Admin can change a Super Admin account.");
    if (!holdsAll(actor, rolePerms(target.role))) throw forbidden("This user has permissions you do not have, so you cannot change their account.");
}

async function loadTarget(id, db = prisma) {
    const t = await db.user.findFirst({
        where: { id, ...NOT_STUDENT },
        select: { id: true, name: true, email: true, phone: true, status: true, roleId: true, role: { select: { key: true, name: true, permissions: true } } },
    });
    if (!t) throw notFound();
    return t;
}

async function loadRole(roleId, db = prisma) {
    const role = await db.role.findUnique({ where: { id: roleId }, select: { id: true, key: true, name: true, permissions: true } });
    if (!role) throw new AppError(400, "BAD_REQUEST", "Please check the highlighted fields.", [{ path: "roleId", message: "This role does not exist.", in: "body" }]);
    return role;
}

/** Serialises Super Admin changes and fails if none would be left active. Call inside tx() after the update. */
async function assertSuperAdminRemains(t) {
    await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('school:superadmin'))`;
    const n = await t.user.count({ where: { status: "ACTIVE", role: { key: ROLE_KEYS.SUPER_ADMIN } } });
    if (n < 1) throw conflict("At least one active Super Admin must remain.");
}

const revokeSessions = (t, userId) => t.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

/* ------------------------------ writes ------------------------------ */

/**
 * @param {{ name: string, email?: string | null, phone?: string | null, roleId: string, password?: string | null, staffId?: string | null }} input
 * @param {AuthUser} actor
 * @param {AuditCtx} ctx
 * @returns {Promise<{ user: Awaited<ReturnType<typeof getUser>>, tempPassword?: string }>}
 */
export async function createUser(input, actor, ctx) {
    const role = await loadRole(input.roleId);
    assertCanAssign(actor, role);

    const generated = input.password ? null : tempPassword();
    const passwordHash = await hashPassword(input.password ?? generated);

    const id = await tx(async (t) => {
        if (input.staffId) {
            const staff = await t.staff.findUnique({ where: { id: input.staffId }, select: { userId: true } });
            if (!staff) throw badRequest("Please check the highlighted fields.", [{ path: "staffId", message: "This staff record does not exist.", in: "body" }]);
            if (staff.userId) throw conflict("This staff member already has a login.");
        }
        const u = await t.user.create({
            data: {
                name: input.name,
                email: input.email ?? null,
                phone: input.phone ?? null,
                passwordHash,
                roleId: role.id,
                mustChangePassword: true,
            },
            select: { id: true },
        });
        if (input.staffId) {
            // Conditional: a concurrent link to the same staff record loses.
            const { count } = await t.staff.updateMany({ where: { id: input.staffId, userId: null }, data: { userId: u.id } });
            if (count !== 1) throw conflict("This staff member already has a login.");
        }
        await audit(
            ctx,
            {
                action: "user.create",
                entity: "User",
                entityId: u.id,
                after: { detail: `Created ${input.name} as ${role.name}`, email: input.email ?? null, phone: input.phone ?? null, role: role.key },
            },
            t,
        );
        return u.id;
    });

    return { user: await getUser(id), ...(generated && { tempPassword: generated }) };
}

/**
 * @param {string} id
 * @param {{ name?: string, email?: string | null, phone?: string | null, roleId?: string, status?: "ACTIVE" | "DISABLED" }} patch
 * @param {AuthUser} actor
 * @param {AuditCtx} ctx
 */
export async function updateUser(id, patch, actor, ctx) {
    const target = await loadTarget(id);
    assertCanManage(actor, target);

    const self = target.id === actor.id;
    const roleChange = patch.roleId && patch.roleId !== target.roleId ? await loadRole(patch.roleId) : null;
    if (roleChange) {
        if (self) throw badRequest("You cannot change your own role.");
        assertCanAssign(actor, roleChange);
    }
    const statusChange = patch.status && patch.status !== target.status ? patch.status : null;
    if (statusChange === "DISABLED" && self) throw badRequest("You cannot disable your own account.");

    const email = patch.email !== undefined ? patch.email : target.email;
    const phone = patch.phone !== undefined ? patch.phone : target.phone;
    if (!email && !phone) throw badRequest("Please check the highlighted fields.", [{ path: "email", message: "Keep an email or a mobile number to sign in with.", in: "body" }]);

    const data = {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.email !== undefined && { email: patch.email }),
        ...(patch.phone !== undefined && { phone: patch.phone }),
        ...(roleChange && { roleId: roleChange.id }),
        ...(statusChange && { status: statusChange }),
    };
    const before = Object.fromEntries(Object.keys(data).map((k) => [k, k === "roleId" ? target.role.key : target[k]]));
    const after = { ...data, ...(roleChange && { roleId: roleChange.key }) };

    const touchesSuper = target.role.key === ROLE_KEYS.SUPER_ADMIN && (roleChange || statusChange === "DISABLED");
    const detail = [
        roleChange && `role ${target.role.name} → ${roleChange.name}`,
        statusChange && (statusChange === "DISABLED" ? "disabled" : "enabled"),
        (patch.name !== undefined || patch.email !== undefined || patch.phone !== undefined) && "details updated",
    ]
        .filter(Boolean)
        .join(", ");

    await tx(async (t) => {
        await t.user.update({ where: { id }, data });
        if (touchesSuper) await assertSuperAdminRemains(t);
        // Access is re-checked on every request; ending refresh families stops silent re-login too.
        if (roleChange || statusChange === "DISABLED") await revokeSessions(t, id);
        await audit(ctx, { action: "user.update", entity: "User", entityId: id, before, after: { detail: `${target.name}: ${detail}`, ...after } }, t);
    });
    return getUser(id);
}

/**
 * Sets a one-time password (shown once to the admin), forces a change at next sign-in, unlocks the
 * account and signs the user out everywhere.
 * @param {string} id @param {AuthUser} actor @param {AuditCtx} ctx
 */
export async function resetPassword(id, actor, ctx) {
    const target = await loadTarget(id);
    if (target.id === actor.id) throw badRequest("Use Change password for your own account.");
    assertCanManage(actor, target);
    const password = tempPassword();
    const passwordHash = await hashPassword(password);
    await tx(async (t) => {
        await t.user.update({
            where: { id },
            data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        });
        await revokeSessions(t, id);
        await audit(ctx, { action: "user.password_reset", entity: "User", entityId: id, after: { detail: `Reset password for ${target.name}` } }, t);
    });
    return { tempPassword: password };
}

/** Clears a lockout after too many wrong passwords. @param {string} id @param {AuthUser} actor @param {AuditCtx} ctx */
export async function unlockUser(id, actor, ctx) {
    const target = await loadTarget(id);
    assertCanManage(actor, target);
    await tx(async (t) => {
        await t.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null } });
        await audit(ctx, { action: "user.unlock", entity: "User", entityId: id, after: { detail: `Unlocked ${target.name}` } }, t);
    });
    return getUser(id);
}
