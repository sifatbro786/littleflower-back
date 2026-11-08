/**
 * Calendar dates in Asia/Dhaka (PRD §6.4). Postgres DATE columns come back from Prisma as
 * a JS Date at 00:00 UTC of that day, so DATE values are always built and read with these helpers.
 * Never derive a school date from a UTC timestamp with toISOString().slice(0, 10).
 */

export const SCHOOL_TZ = "Asia/Dhaka";

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hm = new Intl.DateTimeFormat("en-GB", { timeZone: SCHOOL_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" of an instant, in Dhaka. @param {Date} [at] */
export function dhakaDateString(at = new Date()) {
    return ymd.format(at);
}

/** "HH:mm" of an instant, in Dhaka (absent SMS cutoff, routine "now"). @param {Date} [at] */
export function dhakaTimeString(at = new Date()) {
    return hm.format(at);
}

/** "YYYY-MM" in Dhaka (invoice month). @param {Date} [at] */
export function dhakaMonthString(at = new Date()) {
    return dhakaDateString(at).slice(0, 7);
}

/**
 * Value for a Prisma @db.Date field from "YYYY-MM-DD".
 * @param {string} iso
 */
export function toDbDate(iso) {
    if (!ISO_DATE.test(iso)) throw new Error(`Invalid date "${iso}" (expected YYYY-MM-DD)`);
    const d = new Date(`${iso}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new Error(`Invalid date "${iso}"`);
    return d;
}

/** Today's DATE value in Dhaka. */
export const dbToday = () => toDbDate(dhakaDateString());

/**
 * "YYYY-MM-DD" from a Prisma @db.Date value (UTC midnight). Do NOT use for timestamptz values.
 * @param {Date | null | undefined} d
 */
export function fromDbDate(d) {
    return d ? d.toISOString().slice(0, 10) : null;
}

/** @param {string} iso @param {number} n */
export function addDays(iso, n) {
    const d = toDbDate(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
/** Prisma Weekday enum value of a "YYYY-MM-DD". @param {string} iso */
export const weekdayOf = (iso) => WEEKDAYS[toDbDate(iso).getUTCDay()];
