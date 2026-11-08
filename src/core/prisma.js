import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { env } from "#config/env.js";
import { logger } from "#core/logger.js";

/**
 * One PrismaClient per process (API and worker each have their own pool).
 * Prisma 7 talks to Postgres through the pg driver adapter.
 */
const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});

export const prisma = new PrismaClient({
    adapter,
    log: [
        { emit: "event", level: "warn" },
        { emit: "event", level: "error" },
    ],
});

prisma.$on("warn", (e) => logger.warn({ prisma: e }, "prisma warning"));
prisma.$on("error", (e) => logger.error({ prisma: e }, "prisma error"));

/**
 * Interactive transaction with sane limits. Money and result code always goes through this.
 * @template T
 * @param {(tx: import("@prisma/client").Prisma.TransactionClient) => Promise<T>} fn
 * @param {{ timeout?: number, isolationLevel?: import("@prisma/client").Prisma.TransactionIsolationLevel }} [opts]
 * @returns {Promise<T>}
 */
export function tx(fn, opts = {}) {
    return prisma.$transaction(fn, { maxWait: 5_000, timeout: opts.timeout ?? 15_000, isolationLevel: opts.isolationLevel });
}

/**
 * Next number of a row-locked counter (receipt numbers). Call ONLY inside tx().
 * UPDATE takes a row lock held until commit, so two cashiers at the same second get n and n+1,
 * and a rolled-back payment releases its number (gap free). No Postgres sequences.
 * @param {import("@prisma/client").Prisma.TransactionClient} t
 * @param {string} key e.g. "receipt:2026"
 */
export async function nextCounter(t, key) {
    const row = await t.counter.upsert({
        where: { key },
        create: { key, value: 1 },
        update: { value: { increment: 1 } },
        select: { value: true },
    });
    return row.value;
}

export async function disconnectPrisma() {
    await prisma.$disconnect();
}
