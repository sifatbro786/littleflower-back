/** Bangladesh mobile numbers: accepts +8801XXXXXXXXX / 8801… / 01…, spaces and dashes; stores 01XXXXXXXXX. */
const BD_MOBILE = /^(?:\+?88)?(01[3-9]\d{8})$/;

/** @param {string | null | undefined} raw @returns {string | null} normalised 01XXXXXXXXX or null */
export function normalizeBdPhone(raw) {
    if (!raw) return null;
    const m = String(raw).replace(/[\s-]/g, "").match(BD_MOBILE);
    return m ? m[1] : null;
}
