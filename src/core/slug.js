/** "Annual Sports Day 2026!" → "annual-sports-day-2026" (ASCII; Bangla titles fall back to a dated slug). */
export function slugify(text, fallback = "post") {
    const s = String(text ?? "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80)
        .replace(/-+$/, "");
    return s || `${fallback}-${Date.now().toString(36)}`;
}

/**
 * First free slug: base, base-2, base-3 …
 * @param {(slug: string) => Promise<boolean>} taken
 */
export async function uniqueSlug(base, taken) {
    for (let i = 1; i < 200; i++) {
        const s = i === 1 ? base : `${base}-${i}`;
        if (!(await taken(s))) return s;
    }
    return `${base}-${Date.now().toString(36)}`;
}
