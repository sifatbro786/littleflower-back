import "dotenv/config";

import { z } from "zod";

/**
 * Validated environment. Imported first by server.js, worker.js, seeds and scripts.
 * Fails fast with the names of bad variables only (values are never printed).
 */

const bool = z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1");

const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /**
     * Short id of this school install (lowercase, e.g. "littleflower"). Drives the JWT issuer/audience,
     * auth cookie names (<slug>_at / <slug>_rt, must equal web config/school.js `slug`), Redis connection
     * names and the default QUEUE_PREFIX, so two schools on one VPS or one Redis never mix.
     */
    APP_SLUG: z.string().regex(/^[a-z][a-z0-9]{1,23}$/, "lowercase letters and digits, 2-24 chars").default("littleflower"),
    /** Namespaces BullMQ and rate-limit keys so a shared Redis (STR VPS) never mixes projects. Default: APP_SLUG */
    QUEUE_PREFIX: z.string().optional(),

    JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
    /** HMAC pepper for refresh token hashes stored in the DB */
    JWT_REFRESH_SECRET: z.string().min(32, "must be at least 32 characters"),

    APP_URL: z.url().default("http://localhost:3000"),
    WEB_INTERNAL_URL: z.url().default("http://127.0.0.1:3000"),
    REVALIDATE_SECRET: z.string().min(16).optional(),
    UPLOAD_DIR: z.string().default("./uploads"),
    BEHIND_CLOUDFLARE: bool,

    // Step 2+ (optional until then)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().optional(),
    /** Where website contact-form messages are emailed (the office inbox) */
    CONTACT_TO: z.email().optional(),
    SMS_PROVIDER: z.string().optional(),
    SMS_API_KEY: z.string().optional(),
    SMS_SENDER_ID: z.string().optional(),
    SSLC_STORE_ID: z.string().optional(),
    SSLC_STORE_PASS: z.string().optional(),
    SSLC_SANDBOX: bool,

    // Seed
    SUPERADMIN_EMAIL: z.email().optional(),
    SUPERADMIN_PASSWORD: z.string().min(10).optional(),
    SEED_DEMO: bool,
    SEED_DEMO_PASSWORD: z.string().min(8).optional(),
});

// "KEY=" in .env means "not set"
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
const parsed = schema.safeParse(raw);

if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    console.error(`Invalid environment (.env):\n${lines.join("\n")}`);
    process.exit(1);
}

if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    console.error("Invalid environment (.env):\n  - JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different");
    process.exit(1);
}

export const env = Object.freeze({
    ...parsed.data,
    QUEUE_PREFIX: parsed.data.QUEUE_PREFIX || parsed.data.APP_SLUG,
    isProd: parsed.data.NODE_ENV === "production",
    isDev: parsed.data.NODE_ENV === "development",
});
