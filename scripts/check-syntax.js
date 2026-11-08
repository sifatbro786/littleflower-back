import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { transform } from "esbuild";

/** npm run check:syntax — esbuild parses every .js file (no bundling, no type checks). */
const ROOTS = ["src", "prisma", "scripts", "test", "prisma.config.js"];
const files = [];
async function walk(p) {
    if (p.endsWith(".js")) return files.push(p);
    let entries;
    try {
        entries = await readdir(p, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) if (e.name !== "node_modules" && e.name !== "migrations") await walk(join(p, e.name));
}
for (const r of ROOTS) await walk(r);

let failed = 0;
for (const f of files) {
    try {
        await transform(await readFile(f, "utf8"), { loader: "js", format: "esm", sourcefile: f, logLevel: "silent" });
    } catch (err) {
        failed++;
        console.error(`✗ ${f}\n${err.errors?.map((e) => `  ${e.location?.line}:${e.location?.column} ${e.text}`).join("\n") ?? err.message}`);
    }
}
console.log(failed ? `${failed} of ${files.length} files have syntax errors` : `✓ ${files.length} files parsed`);
process.exitCode = failed ? 1 : 0;
