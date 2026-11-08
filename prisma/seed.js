import { env } from "#config/env.js";
import { disconnectPrisma, prisma } from "#core/prisma.js";

import { seedBootstrap } from "./seed/bootstrap.js";
import { seedContent } from "./seed/content.js";
import { seedDemo } from "./seed/demo/index.js";
import { backfillSnapshots } from "#modules/exams/exams.service.js";

/**
 * npx prisma db seed  (npm run db:seed)
 * bootstrap + content: idempotent, create-if-missing; safe in production.
 * demo: only with SEED_DEMO=true, blocked in production.
 */
async function main() {
    console.log(`Seeding (${env.NODE_ENV})`);
    await seedBootstrap(prisma);
    await seedContent(prisma);
    if (env.SEED_DEMO) {
        if (env.isProd) throw new Error("SEED_DEMO=true is not allowed in production");
        await seedDemo(prisma);
        // Demo exams are seeded as PUBLISHED: freeze their results the same way the publish button does.
        for (const r of await backfillSnapshots()) console.log(`  results frozen: ${r.name} (${r.students} students)`);
    }
    console.log("Seed finished");
}

main()
    .catch((err) => {
        console.error("Seed failed:", err.message);
        if (!env.isProd) console.error(err);
        process.exitCode = 1;
    })
    .finally(() => disconnectPrisma());
