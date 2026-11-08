import { audit } from "#core/audit.js";
import { badRequest, conflict, forbidden, notFound } from "#core/errors.js";
import { prisma, tx } from "#core/prisma.js";
import { holdsAll, ROLE_KEYS, STAFF_PERMISSIONS } from "#core/rbac.js";

/**
 * Roles = named permission sets (PRD §5). System roles keep their key and name (code and seed refer to
 * them) but their permissions can be edited; custom roles can be renamed and deleted when unused.
 * Super Admin (always everything) and Student (portal only) are not editable here.
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */
/** @typedef {import("#core/auth.js").AuthUser} AuthUser */

const LOCKED = new Set([ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.STUDENT]);
const ORDER = ["SUPER_ADMIN", "ADMIN", "OFFICE", "ACCOUNTANT", "TEACHER"];

const select = { id: true, key: true, name: true, description: true, permissions: true, isSystem: true, _count: { select: { users: true } } };

/** Shape of littleflower-front lib/dashboard/users listRoles() items. */
const toItem = (r) => ({
    id: r.id,
    role: r.key,
    label: r.name,
    description: r.description,
    permissions: r.key === ROLE_KEYS.SUPER_ADMIN ? [...STAFF_PERMISSIONS] : r.permissions,
    isSystem: r.isSystem,
    editable: !LOCKED.has(r.key),
    userCount: r._count.users,
});

export async function listRoles() {
    const roles = await prisma.role.findMany({ where: { key: { not: ROLE_KEYS.STUDENT } }, select });
    const rank = (k) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
    return roles.sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name)).map(toItem);
}

/** @param {string} id */
export async function getRole(id) {
    const r = await prisma.role.findUnique({ where: { id }, select });
    if (!r || r.key === ROLE_KEYS.STUDENT) throw notFound();
    return toItem(r);
}

/** "Exam Controller" → "EXAM_CONTROLLER" */
const keyFrom = (name) =>
    name
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s-]+/g, "_")
        .toUpperCase()
        .slice(0, 40) || "ROLE";

const diff = (before, after) => ({
    granted: after.filter((p) => !before.includes(p)),
    revoked: before.filter((p) => !after.includes(p)),
});

/**
 * @param {{ name: string, description?: string, permissions: string[] }} input
 * @param {AuthUser} actor @param {AuditCtx} ctx
 */
export async function createRole(input, actor, ctx) {
    if (!holdsAll(actor, input.permissions)) throw forbidden("You cannot give permissions you do not have yourself.");
    let key = keyFrom(input.name);
    if (LOCKED.has(key) || ORDER.includes(key)) key = `${key}_CUSTOM`;
    if (await prisma.role.findUnique({ where: { key }, select: { id: true } })) throw conflict("A role with this name already exists.");
    const id = await tx(async (t) => {
        const r = await t.role.create({ data: { key, name: input.name, description: input.description || null, permissions: input.permissions, isSystem: false }, select: { id: true } });
        await audit(ctx, { action: "role.create", entity: "Role", entityId: key, after: { detail: `Created role ${input.name}`, permissions: input.permissions } }, t);
        return r.id;
    });
    return getRole(id);
}

/**
 * @param {string} id
 * @param {{ name?: string, description?: string | null, permissions?: string[] }} patch
 * @param {AuthUser} actor @param {AuditCtx} ctx
 */
export async function updateRole(id, patch, actor, ctx) {
    const role = await prisma.role.findUnique({ where: { id }, select: { id: true, key: true, name: true, permissions: true, isSystem: true } });
    if (!role || role.key === ROLE_KEYS.STUDENT) throw notFound();
    if (LOCKED.has(role.key)) throw badRequest("The Super Admin role always has every permission and cannot be edited.");
    if (patch.name !== undefined && patch.name !== role.name && role.isSystem) throw badRequest("Built-in roles cannot be renamed.");

    const isSuper = actor.role === ROLE_KEYS.SUPER_ADMIN;
    let change = { granted: [], revoked: [] };
    if (patch.permissions) {
        change = diff(role.permissions, patch.permissions);
        // Editing your own role would let you grant yourself anything you can name.
        if (!isSuper && actor.role === role.key) throw forbidden("You cannot change the permissions of your own role.");
        if (!holdsAll(actor, [...change.granted, ...change.revoked])) throw forbidden("You can only grant or remove permissions you have yourself.");
    }

    const parts = [
        change.granted.length && `granted ${change.granted.join(", ")}`,
        change.revoked.length && `removed ${change.revoked.join(", ")}`,
        patch.name !== undefined && patch.name !== role.name && `renamed to ${patch.name}`,
    ].filter(Boolean);

    await tx(async (t) => {
        await t.role.update({
            where: { id },
            data: {
                ...(patch.name !== undefined && { name: patch.name }),
                ...(patch.description !== undefined && { description: patch.description || null }),
                ...(patch.permissions && { permissions: patch.permissions }),
            },
        });
        await audit(
            ctx,
            {
                action: "role.update",
                entity: "Role",
                entityId: role.key,
                before: { name: role.name, permissions: role.permissions },
                after: { detail: `${role.name}: ${parts.join("; ") || "details updated"}`, name: patch.name ?? role.name, ...change },
            },
            t,
        );
    });
    return getRole(id);
}

/** Custom roles only, and only when no user has them. @param {string} id @param {AuthUser} _actor @param {AuditCtx} ctx */
export async function deleteRole(id, _actor, ctx) {
    const role = await prisma.role.findUnique({ where: { id }, select: { key: true, name: true, isSystem: true, _count: { select: { users: true } } } });
    if (!role || role.key === ROLE_KEYS.STUDENT) throw notFound();
    if (role.isSystem) throw badRequest("Built-in roles cannot be deleted.");
    if (role._count.users > 0) throw conflict(`${role._count.users} user(s) still have this role. Move them to another role first.`);
    await tx(async (t) => {
        await t.role.delete({ where: { id } });
        await audit(ctx, { action: "role.delete", entity: "Role", entityId: role.key, after: { detail: `Deleted role ${role.name}` } }, t);
    });
    return { deleted: true };
}
