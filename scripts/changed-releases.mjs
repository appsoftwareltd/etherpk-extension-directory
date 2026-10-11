/**
 * Lists the releases a pull request adds or changes, so CI runs the release check on each of them.
 *
 * Usage: node scripts/changed-releases.mjs [base-ref] [head-ref]
 *
 * Compares extensions/ at base-ref (default origin/main) with head-ref, or with the working tree
 * when no head-ref is given. Prints one "id@version" line for each release that is new or whose
 * integrity, minClientVersion or source changed. A change to an entry's package or repository lists
 * all of its releases. A removed release needs no rebuild, so it is not printed, but it is reported
 * on standard error.
 */
import { changedReleases } from "./lib.mjs";

const [base = "origin/main", head] = process.argv.slice(2);

let result;
try {
    result = changedReleases({ base, head });
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

for (const release of result.removed) console.error(`removed: ${release}`);
for (const release of result.changed) console.log(release);
if (result.changed.length === 0) console.error("No releases added or changed.");
