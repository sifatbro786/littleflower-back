import sanitizeHtml from "sanitize-html";

/**
 * Rich text from the CMS editor → safe HTML (PRD §11). Run on every save, never trust the client.
 * Allowlist only: no scripts, styles, event handlers, iframes or data: URLs.
 */
const OPTIONS = {
    allowedTags: ["p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "blockquote", "ul", "ol", "li", "a", "img", "figure", "figcaption", "hr", "table", "thead", "tbody", "tr", "th", "td"],
    allowedAttributes: {
        a: ["href", "target", "rel"],
        img: ["src", "alt", "width", "height"],
        th: ["colspan", "rowspan"],
        td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    transformTags: {
        b: "strong",
        i: "em",
        h1: "h2",
        div: "p",
        a: (tagName, attribs) => ({
            tagName,
            attribs: attribs.target === "_blank" ? { ...attribs, rel: "noopener noreferrer" } : { href: attribs.href },
        }),
    },
    exclusiveFilter: (frame) => ["p", "li", "h2", "h3", "h4"].includes(frame.tag) && !frame.text.trim() && !frame.mediaChildren?.length,
};

/** @param {string | null | undefined} html */
export function cleanHtml(html) {
    return sanitizeHtml(String(html ?? ""), OPTIONS).trim();
}

/** Plain text for excerpts and meta descriptions. */
export function plainText(html, max = 200) {
    const spaced = String(html ?? "").replace(/<\/(p|li|h[1-6]|blockquote|td|th)>|<br\s*\/?>/gi, " ");
    const t = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
