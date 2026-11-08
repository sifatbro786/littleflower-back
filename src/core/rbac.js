import { AppError, forbidden, unauthorized } from "#core/errors.js";

/**
 * RBAC (PRD §5). Permissions are strings; a role is a set of them stored in Role.permissions.
 * The catalogue below mirrors littleflower-front lib/auth/permissions.js (keep both in sync).
 * "Own" scopes (teacher's subjects, guardian's child) are NOT permissions: services enforce them
 * with query filters and answer 404 on a miss.
 */

export const PERMISSION_GROUPS = Object.freeze([
    { module: "Dashboard", perms: [["dashboard.view", "View dashboard"]] },
    { module: "Website content", perms: [["website.manage", "Manage pages, news, gallery"], ["notices.manage", "Post and pin notices"]] },
    { module: "Students & classes", perms: [["students.view", "View students"], ["students.manage", "Add, edit, promote, import"], ["academics.manage", "Sessions, classes, subjects"]] },
    { module: "Attendance", perms: [["attendance.take", "Take attendance"], ["attendance.view", "Attendance reports"]] },
    { module: "Exams & results", perms: [["exams.manage", "Create exams, set marks"], ["marks.enter", "Enter marks"], ["results.publish", "Publish / unpublish results"]] },
    { module: "Routine", perms: [["routine.manage", "Edit class routine"], ["routine.view", "View routines"]] },
    { module: "Cards", perms: [["cards.generate", "Admit & ID cards"]] },
    { module: "Fees", perms: [["fees.view", "View fees & reports"], ["fees.collect", "Collect payments"], ["fees.manage", "Fee setup, reversals"]] },
    { module: "SMS", perms: [["sms.send", "Send SMS"], ["sms.dues", "Send due reminders only"]] },
    { module: "Administration", perms: [["users.manage", "Users & roles"], ["settings.manage", "School settings"], ["audit.view", "Audit log"]] },
    { module: "Portal", perms: [["portal.view", "Student / guardian portal"]] },
]);

export const PERMISSIONS = Object.freeze(PERMISSION_GROUPS.flatMap((g) => g.perms.map(([p]) => p)));

export const ROLE_KEYS = Object.freeze({
    SUPER_ADMIN: "SUPER_ADMIN",
    ADMIN: "ADMIN",
    OFFICE: "OFFICE",
    ACCOUNTANT: "ACCOUNTANT",
    TEACHER: "TEACHER",
    STUDENT: "STUDENT",
});

const STAFF_ALL = PERMISSIONS.filter((p) => p !== "portal.view");

/** Default system roles, used by the bootstrap seed (create-if-missing only). */
export const DEFAULT_ROLES = Object.freeze([
    { key: "SUPER_ADMIN", name: "Super Admin", permissions: STAFF_ALL },
    {
        key: "ADMIN",
        name: "Principal / Admin",
        permissions: STAFF_ALL.filter((p) => !["users.manage", "settings.manage", "fees.collect", "fees.manage"].includes(p)),
    },
    {
        key: "OFFICE",
        name: "Office Staff",
        permissions: ["dashboard.view", "website.manage", "notices.manage", "students.view", "students.manage", "academics.manage", "attendance.view", "routine.manage", "routine.view", "cards.generate", "sms.send"],
    },
    { key: "ACCOUNTANT", name: "Accountant", permissions: ["dashboard.view", "students.view", "fees.view", "fees.collect", "fees.manage", "sms.dues"] },
    { key: "TEACHER", name: "Teacher", permissions: ["dashboard.view", "students.view", "attendance.take", "marks.enter", "routine.view"] },
    { key: "STUDENT", name: "Student / Guardian", permissions: ["portal.view"] },
]);

/**
 * Super Admin always has every staff permission, so permissions added in later releases
 * work for them without a data migration.
 * @param {{ role: string, permissions: Set<string> } | null | undefined} user
 * @param {string} perm
 */
export function can(user, perm) {
    if (!user) return false;
    if (user.role === ROLE_KEYS.SUPER_ADMIN) return perm !== "portal.view";
    return user.permissions.has(perm);
}

/** 401 body: TOKEN_EXPIRED tells the frontend to call /api/auth/refresh and retry. */
const noSession = (req) => (req.authError === "expired" ? new AppError(401, "TOKEN_EXPIRED", "Session expired") : unauthorized());

/** All listed permissions required. 401 without a session, 403 without the permission. */
export const requirePermission =
    (...perms) =>
    (req, _res, next) => {
        if (!req.user) return next(noSession(req));
        if (!perms.every((p) => can(req.user, p))) return next(forbidden());
        next();
    };

/** Any one of the listed permissions (e.g. "sms.send" or "sms.dues"). */
export const requireAnyPermission =
    (...perms) =>
    (req, _res, next) => {
        if (!req.user) return next(noSession(req));
        if (!perms.some((p) => can(req.user, p))) return next(forbidden());
        next();
    };

/** Every staff permission (Super Admin's effective set). */
export const STAFF_PERMISSIONS = Object.freeze(PERMISSIONS.filter((p) => p !== "portal.view"));

/**
 * Effective permission set of a signed-in user (Super Admin = every staff permission).
 * @param {{ role: string, permissions: Set<string> }} user
 * @returns {Set<string>}
 */
export function effectivePermissions(user) {
    return user.role === ROLE_KEYS.SUPER_ADMIN ? new Set(STAFF_PERMISSIONS) : user.permissions;
}

/**
 * No privilege escalation: a non-Super-Admin may only grant, revoke or assign permissions they hold.
 * @param {{ role: string, permissions: Set<string> }} actor
 * @param {Iterable<string>} perms
 */
export function holdsAll(actor, perms) {
    const mine = effectivePermissions(actor);
    for (const p of perms) if (!mine.has(p)) return false;
    return true;
}

/** Any signed-in staff member (not a student/guardian). For shared lookups like section lists. */
export const requireStaffUser = (req, _res, next) => {
    if (!req.user) return next(noSession(req));
    if (req.user.role === ROLE_KEYS.STUDENT) return next(forbidden());
    next();
};
