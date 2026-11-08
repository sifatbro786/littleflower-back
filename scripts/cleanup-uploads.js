import { disconnectPrisma } from "#core/prisma.js";

import { cleanupOrphanUploads } from "#jobs/maintenance.js";

/**
 * npm run uploads:cleanup -- [--dry] [--force]
 * Deletes uploaded files no database row references (older than 24 h). The worker runs this nightly.
 * --dry lists what would go; --force skips the "more than half of all files" safety stop.
 */
const args = new Set(process.argv.slice(2));
try {
    const r = await cleanupOrphanUploads({ dryRun: args.has("--dry"), force: args.has("--force") });
    if (r.aborted) {
        console.error(`✗ stopped: ${r.orphans} of ${r.files} files look unused. Check the database, then run with --force if that is right.`);
        process.exitCode = 1;
    } else {
        console.log(`✓ ${r.files} files, ${r.referenced} referenced, ${r.orphans} unused${args.has("--dry") ? " (dry run, nothing deleted)" : `, ${r.deleted} deleted`}`);
        for (const p of r.sample) console.log(`  ${p}`);
    }
} catch (err) {
    console.error("✗ cleanup failed:", err.message);
    process.exitCode = 1;
} finally {
    await disconnectPrisma();
}
