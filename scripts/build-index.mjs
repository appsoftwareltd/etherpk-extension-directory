/**
 * Builds directory.json from the entries in extensions/. It checks the entries first and writes
 * nothing when one has a problem.
 *
 * Usage: node scripts/build-index.mjs [--check]
 *
 * With --check, it writes nothing and exits 1 when the committed directory.json is not what the
 * entries build. CI runs it that way, so the list the Client reads always matches the entries.
 */
import { parseArgs } from "node:util";
import { buildIndex, count } from "./lib.mjs";

let check;
try {
    ({ values: { check } } = parseArgs({ options: { check: { type: "boolean", default: false } } }));
} catch (error) {
    console.error(error.message);
    console.error("Usage: node scripts/build-index.mjs [--check]");
    process.exit(2);
}

const result = buildIndex({ check });
const summary = `${count(result.extensions, "extension")} with ${count(result.releases, "release")}`;

switch (result.status) {
    case "invalid":
        console.error(`directory.json was not built, because extensions/ has ${count(result.problems.length, "problem")}:`);
        for (const problem of result.problems) console.error(`  ${problem}`);
        process.exit(1);
        break;
    case "stale":
        console.error("directory.json is out of date. Run `npm run build` and commit the result.");
        process.exit(1);
        break;
    case "current":
        console.log(`directory.json is up to date: ${summary}.`);
        break;
    case "written":
        console.log(`Wrote directory.json: ${summary}.`);
        break;
}
