/**
 * Checks every entry in extensions/ and lists every problem found.
 *
 * Usage: node scripts/validate.mjs
 *
 * Exits 0 when every entry is valid and 1 otherwise.
 */
import { count, loadExtensions } from "./lib.mjs";

const { entries, problems } = loadExtensions();

if (problems.length > 0) {
    console.error(`Found ${count(problems.length, "problem")} in extensions/:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
}

const releases = entries.reduce((total, entry) => total + entry.releases.length, 0);
console.log(`extensions/ is valid: ${count(entries.length, "extension")} with ${count(releases, "release")}.`);
