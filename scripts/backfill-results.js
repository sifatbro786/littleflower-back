import { disconnectPrisma } from "#core/prisma.js";

import { backfillSnapshots } from "#modules/exams/exams.service.js";

/**
 * npm run results:backfill — freezes ResultSnapshots for exams that are PUBLISHED but have none
 * (databases seeded before Step 4, or exams imported as published). Safe to run again: exams that
 * already have snapshots are skipped. Keeps each exam's original publishedAt. Sends no SMS.
 */
try {
    const done = await backfillSnapshots();
    if (!done.length) console.log("✓ nothing to do: every published exam already has results");
    for (const r of done) console.log(`✓ ${r.name}: ${r.students} results frozen`);
} catch (err) {
    console.error("✗ backfill failed:", err.message);
    process.exitCode = 1;
} finally {
    await disconnectPrisma();
}
