import { audit } from "#core/audit.js";
import { conflict, notFound } from "#core/errors.js";
import { prisma, tx } from "#core/prisma.js";
import { revalidateWeb } from "#core/revalidate.js";
import { removeStored, url } from "#core/storage.js";

import { clearStaffAssignments, getCurrentSession, sectionLabel } from "#modules/academics/academics.service.js";

/**
 * Teachers & office staff (PRD §6.2). A staff record may exist without a login (website listing);
 * logins are created and linked in Users & roles. showOnWebsite controls the public Teachers page.
 */

/** @typedef {import("#core/audit.js").AuditCtx} AuditCtx */

const ymd = (d) => (d ? d.toISOString().slice(0, 10) : null);

/** lib/dashboard/academics listStaff() shape (current session for class teacher / subjects). */
export async function listStaff({ includeInactive = false } = {}) {
    const session = await getCurrentSession();
    const rows = await prisma.staff.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ isActive: "desc" }, { order: "asc" }, { name: "asc" }],
        include: {
            user: { select: { id: true, status: true } },
            classTeacherOf: { where: { sessionId: session.id }, include: { section: { include: { class: { select: { name: true, order: true } } } } } },
            assignments: { where: { sessionId: session.id }, include: { subject: { select: { name: true } }, section: { include: { class: { select: { name: true, order: true } } } } } },
        },
    });
    return rows.map((t) => ({
        id: t.id,
        name: t.name,
        designation: t.designation,
        qualification: t.qualification ?? "",
        phone: t.phone ?? "",
        email: t.email ?? "",
        photo: url(t.photoPath),
        group: t.group,
        showOnWebsite: t.showOnWebsite,
        isActive: t.isActive,
        hasLogin: Boolean(t.user),
        joinedAt: ymd(t.joinedAt),
        classTeacherOf: t.classTeacherOf.sort((a, b) => a.section.class.order - b.section.class.order).map((c) => sectionLabel(c.section)),
        subjects: [...new Set(t.assignments.sort((a, b) => a.section.class.order - b.section.class.order).map((a) => `${a.subject.name} · ${a.section.class.name}`))],
    }));
}

export async function getStaff(id) {
    const t = await prisma.staff.findUnique({ where: { id }, include: { user: { select: { id: true, email: true, phone: true, status: true, role: { select: { name: true } } } } } });
    if (!t) throw notFound();
    return {
        id: t.id,
        name: t.name,
        designation: t.designation,
        qualification: t.qualification,
        phone: t.phone,
        email: t.email,
        photo: t.photoPath ? { path: t.photoPath, url: url(t.photoPath), alt: t.name } : null,
        group: t.group,
        showOnWebsite: t.showOnWebsite,
        order: t.order,
        joinedAt: ymd(t.joinedAt),
        isActive: t.isActive,
        login: t.user ? { userId: t.user.id, identifier: t.user.email ?? t.user.phone, role: t.user.role.name, status: t.user.status } : null,
    };
}

const data = (i) => ({
    ...(i.name !== undefined && { name: i.name }),
    ...(i.designation !== undefined && { designation: i.designation }),
    ...(i.qualification !== undefined && { qualification: i.qualification }),
    ...(i.phone !== undefined && { phone: i.phone }),
    ...(i.email !== undefined && { email: i.email }),
    ...(i.photoPath !== undefined && { photoPath: i.photoPath }),
    ...(i.group !== undefined && { group: i.group }),
    ...(i.showOnWebsite !== undefined && { showOnWebsite: i.showOnWebsite }),
    ...(i.order !== undefined && { order: i.order }),
    ...(i.joinedAt !== undefined && { joinedAt: i.joinedAt ? new Date(`${i.joinedAt}T00:00:00Z`) : null }),
    ...(i.isActive !== undefined && { isActive: i.isActive }),
});

export async function createStaff(input, ctx) {
    const id = await tx(async (t) => {
        const s = await t.staff.create({ data: data(input) });
        await audit(ctx, { action: "staff.create", entity: "Staff", entityId: s.id, after: { detail: `Added ${input.name} (${input.designation})` } }, t);
        return s.id;
    });
    if (input.showOnWebsite) await revalidateWeb(["staff"]);
    return getStaff(id);
}

/**
 * Deactivating keeps history (marks, attendance, payments stay linked) and removes the person from
 * this session's class-teacher and subject assignments, so nobody "teaches" through a former teacher.
 */
export async function updateStaff(id, patch, ctx) {
    const cur = await prisma.staff.findUnique({ where: { id }, select: { name: true, photoPath: true, showOnWebsite: true, isActive: true } });
    if (!cur) throw notFound();
    const deactivating = patch.isActive === false && cur.isActive;
    let freed = 0;
    await tx(async (t) => {
        await t.staff.update({ where: { id }, data: data(patch) });
        if (deactivating) freed = await clearStaffAssignments(id, t);
        await audit(ctx, { action: "staff.update", entity: "Staff", entityId: id, after: { detail: `Edited ${patch.name ?? cur.name}${deactivating ? ` (marked inactive, ${freed} assignments cleared)` : ""}` } }, t);
    });
    if (patch.photoPath !== undefined && patch.photoPath !== cur.photoPath) await removeStored(cur.photoPath);
    if (cur.showOnWebsite || patch.showOnWebsite) await revalidateWeb(["staff"]);
    return getStaff(id);
}

/** Only records with no history at all; everyone else is marked inactive instead. */
export async function deleteStaff(id, ctx) {
    const s = await prisma.staff.findUnique({ where: { id }, include: { _count: { select: { classTeacherOf: true, assignments: true, routineSlots: true } } } });
    if (!s) throw notFound();
    if (s.userId) throw conflict("This person has a login. Disable the login in Users & roles and mark the staff record inactive.");
    if (s._count.classTeacherOf || s._count.assignments || s._count.routineSlots) throw conflict("This person has classes or a routine. Mark them inactive instead.");
    await tx(async (t) => {
        await t.staff.delete({ where: { id } });
        await audit(ctx, { action: "staff.delete", entity: "Staff", entityId: id, after: { detail: `Deleted staff record ${s.name}` } }, t);
    });
    await removeStored(s.photoPath);
    if (s.showOnWebsite) await revalidateWeb(["staff"]);
    return { deleted: true };
}

/** Active staff records without a login (for "link a staff record" when creating a user). */
export async function listUnlinkedStaff() {
    const rows = await prisma.staff.findMany({ where: { userId: null, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true, email: true, phone: true } });
    return rows.map((s) => ({ id: s.id, name: s.name, designation: s.designation, email: s.email, phone: s.phone }));
}

/** Active staff for pickers (routine editor). */
export async function staffOptions() {
    return prisma.staff.findMany({ where: { isActive: true }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } });
}
