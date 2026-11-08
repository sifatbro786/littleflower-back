import { audit } from "#core/audit.js";
import { AppError } from "#core/errors.js";
import { prisma, tx } from "#core/prisma.js";

import { DEFAULTS, SETTING_SCHEMAS } from "./settings.schema.js";

/**
 * School settings (Setting table, key → JSON). Read often (cutoff, weekly off, id prefix), written
 * rarely, so values are cached per process for 30 s (the worker picks up changes within 30 s too).
 */
const TTL_MS = 30_000;
/** @type {Map<string, { at: number, value: unknown }>} */
const cache = new Map();

/** @template T @param {string} key @param {T} fallback @returns {Promise<T>} */
export async function getSetting(key, fallback) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return /** @type {T} */ (hit.value ?? fallback);
    const row = await prisma.setting.findUnique({ where: { key } });
    const value = row?.value ?? null;
    cache.set(key, { at: Date.now(), value });
    return /** @type {T} */ (value ?? fallback);
}

/** Like getSetting, but a stored JSON null stays null (e.g. cards.admitDueLimit: null = never hold). */
async function getNullable(key) {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row ? row.value : DEFAULTS[key];
}

export const weeklyOff = () => getSetting("attendance.weeklyOff", DEFAULTS["attendance.weeklyOff"]);
export const smsCutoff = () => getSetting("attendance.smsCutoff", DEFAULTS["attendance.smsCutoff"]);
export const studentUidPrefix = () => getSetting("ids.studentUidPrefix", DEFAULTS["ids.studentUidPrefix"]);
export const receiptPrefix = () => getSetting("fees.receiptPrefix", null);
export const tieBreak = () => getSetting("results.tieBreak", "roll");
export const admitDueLimit = () => getNullable("cards.admitDueLimit");
export const autoInvoiceDay = () => getNullable("fees.autoInvoiceDay");
export const enabledModules = () => getSetting("modules.enabled", DEFAULTS["modules.enabled"]);
export async function schoolName() {
    const p = await getSetting("school.profile", {});
    return p?.shortName || p?.name || "School";
}

/** Every known setting with its current value (missing rows → default). */
export async function getAllSettings() {
    const rows = await prisma.setting.findMany({ where: { key: { in: Object.keys(SETTING_SCHEMAS) } } });
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    return Object.fromEntries(Object.keys(SETTING_SCHEMAS).map((k) => [k, stored.has(k) ? stored.get(k) : DEFAULTS[k]]));
}

/** Saves a validated subset. Audit keeps before/after per key. */
export async function updateSettings(patch, ctx) {
    const before = await getAllSettings();
    const changed = Object.keys(patch).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(patch[k]));
    if (!changed.length) return before;
    await tx(async (t) => {
        for (const key of changed) {
            const value = patch[key];
            await t.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
        }
        await audit(ctx, { action: "settings.update", entity: "Setting", entityId: changed.join(","), before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: { ...Object.fromEntries(changed.map((k) => [k, patch[k]])), detail: `Changed settings: ${changed.join(", ")}` } }, t);
    });
    for (const k of changed) cache.delete(k);
    return getAllSettings();
}

/**
 * Router guard: a module turned off in settings answers 404 MODULE_OFF (the menu hides it too).
 * @param {string} name one of MODULES
 */
export function requireModule(name) {
    return async (_req, _res, next) => {
        try {
            const on = await enabledModules();
            if (!on.includes(name)) return next(new AppError(404, "MODULE_OFF", "This feature is not enabled for this school."));
            next();
        } catch (err) {
            next(err);
        }
    };
}
