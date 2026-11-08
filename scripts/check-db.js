import { disconnectPrisma, prisma } from "#core/prisma.js";

/** npm run check:db — connection, server version, timezone, migration state. */
try {
    const [info] = await prisma.$queryRaw`
        SELECT version() AS version, current_database() AS db, current_user AS "user",
               current_setting('TimeZone') AS tz, now() AS now`;
    console.log(`✓ connected to "${info.db}" as "${info.user}"`);
    console.log(`  ${String(info.version).split(",")[0]}`);
    console.log(`  server timezone: ${info.tz} (school dates are computed in Asia/Dhaka by the API)`);

    const [mig] = await prisma.$queryRaw`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`;
    if (!mig.ok) {
        console.log("! no migrations applied yet: run  npm run db:migrate -- --name init");
    } else {
        const rows = await prisma.$queryRaw`
            SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at`;
        const pending = rows.filter((r) => !r.finished_at);
        console.log(`✓ ${rows.length} migration(s) applied${pending.length ? `, ${pending.length} FAILED/unfinished: ${pending.map((r) => r.migration_name).join(", ")}` : ""}`);
        const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;
        const [{ roles }] = await prisma.$queryRaw`SELECT count(*)::int AS roles FROM "Role"`;
        console.log(`  ${n} tables, ${roles} roles${roles ? "" : " (run npm run db:seed)"}`);
    }
} catch (err) {
    console.error("✗ database check failed:", err.message);
    process.exitCode = 1;
} finally {
    await disconnectPrisma();
}
