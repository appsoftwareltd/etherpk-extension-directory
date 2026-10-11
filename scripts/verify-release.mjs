/**
 * The release check for one listed release: the package on npm matches the entry, and rebuilding
 * the release from its tagged source gives the same files. See scripts/verify.mjs for the steps.
 *
 * Usage: node scripts/verify-release.mjs <id> <version> [--registry <url>] [--keep]
 *
 *   --registry <url>  the npm registry to fetch from (default https://registry.npmjs.org)
 *   --keep            keep the downloaded, rebuilt and unpacked files, and print where they are
 *
 * Needs git, tar and npm, and pnpm for a release with a pnpm-lock.yaml. Exits 0 only when every
 * check passed.
 */
import { parseArgs } from "node:util";
import { readRelease } from "./lib.mjs";
import { DEFAULT_REGISTRY, verifyRelease } from "./verify.mjs";

const USAGE = "Usage: node scripts/verify-release.mjs <id> <version> [--registry <url>] [--keep]";

let values;
let positionals;
try {
    ({ values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            registry: { type: "string", default: DEFAULT_REGISTRY },
            keep: { type: "boolean", default: false },
        },
    }));
} catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exit(2);
}
if (positionals.length !== 2) {
    console.error(USAGE);
    process.exit(2);
}

const [id, version] = positionals;
const { entry, release, problems: readProblems } = readRelease(id, version);
if (readProblems.length > 0) {
    console.error(`Cannot check ${id} ${version}:`);
    for (const problem of readProblems) console.error(`  ${problem}`);
    process.exit(1);
}

console.log(`Checking ${id} ${version} (${entry.package}, source ${release.source})`);
const result = await verifyRelease({
    entry,
    release,
    registry: values.registry,
    keepWorkDir: values.keep,
    log: (line) => console.log(`  ${line}`),
});

if (!result.ok) {
    console.error(`\n${id} ${version} failed the release check:`);
    for (const problem of result.problems) console.error(`  - ${problem.split("\n").join("\n    ")}`);
    process.exit(1);
}

console.log(`\nVerified ${id} ${version}.`);
console.log(`  package:    ${entry.package}@${release.version}`);
console.log(`  integrity:  ${release.integrity}`);
console.log(`  key:        ${result.key}`);
console.log(`  source:     ${release.source} of ${entry.repository}`);
console.log(`  files:      ${result.files}, each the same in the published package and the rebuild`);
