import "dotenv/config";

/**
 * Tiny cookie-keeping client for the API flow tests. Talks to a RUNNING API (npm run dev) on a
 * development database with the demo seed. Never point it at production: it writes real rows.
 */
export const BASE = (process.env.TEST_API_URL || `http://127.0.0.1:${process.env.PORT || 4020}`).replace(/\/+$/, "");
if (process.env.NODE_ENV === "production") throw new Error("API flow tests write data: refusing to run with NODE_ENV=production");

export function client() {
    let cookie = "";
    async function call(method, path, body) {
        const headers = { accept: "application/json", ...(cookie && { cookie }) };
        if (method !== "GET") headers["content-type"] = "application/json";
        const r = await fetch(BASE + path, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
        const set = r.headers.getSetCookie?.() ?? [];
        if (set.length) {
            const jar = Object.fromEntries(cookie.split("; ").filter(Boolean).map((c) => c.split(/=(.*)/s).slice(0, 2)));
            for (const c of set) {
                const [k, v] = c.split(";")[0].split(/=(.*)/s);
                jar[k] = v;
            }
            cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
        }
        const json = await r.json().catch(() => null);
        return { status: r.status, data: json?.data, error: json?.error };
    }
    return {
        get: (p) => call("GET", p),
        post: (p, b) => call("POST", p, b),
        put: (p, b) => call("PUT", p, b),
        patch: (p, b) => call("PATCH", p, b),
        del: (p) => call("DELETE", p),
        async login(identifier, password) {
            const r = await call("POST", "/api/auth/login", { identifier, password });
            if (r.status !== 200) throw new Error(`login ${identifier}: ${r.status} ${r.error?.message}`);
            return r.data.user;
        },
    };
}

const demoPw = () => {
    if (!process.env.SEED_DEMO_PASSWORD) throw new Error("SEED_DEMO_PASSWORD (from .env) is needed for the demo accounts");
    return process.env.SEED_DEMO_PASSWORD;
};
export const ACCOUNTS = {
    superAdmin: () => [process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD],
    accountant: () => ["accounts@littleflower.demo", demoPw()],
    teacher: () => ["teacher@littleflower.demo", demoPw()],
    guardian: (uid) => [uid, demoPw()],
};
