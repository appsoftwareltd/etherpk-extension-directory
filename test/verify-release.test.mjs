/**
 * The release check end to end, offline. Each test run makes a tiny extension package in a
 * temporary git repository, "publishes" it by packing it with npm, and serves the registry record
 * and the tarball from a local HTTP server. The release check then fetches from that server and
 * rebuilds from the local repository.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { integrityOf } from "../scripts/lib.mjs";
import { rebuildFromSource, verifyRelease } from "../scripts/verify.mjs";
import { exampleEntry, gitIn, hasCommand, temporaryDir, writeJson } from "./helpers.mjs";

const MISSING = ["git", "tar", "npm"].filter((command) => !hasCommand(command));
const SKIP = MISSING.length > 0 ? `the release check needs ${MISSING.join(", ")}, which is not installed` : false;

const NO_PNPM = hasCommand("pnpm") ? false : "pnpm is not installed";

// A pnpm lockfile for a package with no dependencies, as `pnpm install --lockfile-only` writes it.
const PNPM_LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .: {}
`;

const PACKAGE_NAME = "@example/etherpk-extension-garden";
const TARBALL_PATH = "/tarballs/etherpk-extension-garden-1.0.0.tgz";

/** Writes the extension's source: a build script that copies src/main.js into dist/. */
function writeExtensionSource(dir) {
    writeJson(join(dir, "package.json"), {
        name: PACKAGE_NAME,
        version: "1.0.0",
        description: "Adds a planting calendar to documents.",
        license: "MIT",
        type: "module",
        files: ["dist"],
        scripts: { build: "node build.mjs" },
        etherpk: {
            id: "garden",
            displayName: "Garden",
            publisher: "example",
            minClientVersion: "0.9.6",
            main: "./dist/main.js",
        },
    });
    // A lockfile with no dependencies, so `npm ci` installs nothing and needs no network.
    writeJson(join(dir, "package-lock.json"), {
        name: PACKAGE_NAME,
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: PACKAGE_NAME, version: "1.0.0", license: "MIT" } },
    });
    writeFileSync(
        join(dir, "build.mjs"),
        'import { copyFileSync, mkdirSync } from "node:fs";\nmkdirSync("dist", { recursive: true });\ncopyFileSync("src/main.js", "dist/main.js");\n',
    );
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "main.js"), 'export function activate() {\n    return "water the beans";\n}\n');
    writeFileSync(join(dir, "README.md"), "# Garden\n\nAdds a planting calendar to documents.\n");
    writeFileSync(join(dir, ".gitignore"), "dist/\nnode_modules/\n*.tgz\n");
}

/** Packs the source folder as it stands into `destination`, and returns the tarball's bytes. */
function pack(sourceDir, destination) {
    mkdirSync(destination);
    execFileSync("npm", ["pack", "--pack-destination", destination], { cwd: sourceDir, stdio: "ignore" });
    const [name] = readdirSync(destination);
    return readFileSync(join(destination, name));
}

describe("verifyRelease", { skip: SKIP, timeout: 180_000 }, () => {
    let root;
    let sourceDir;
    let commit;
    let published;
    let tampered;
    let server;
    let registry;
    /** The tarball the local registry serves, switched by each test. */
    let served;

    before(async () => {
        root = mkdtempSync(join(tmpdir(), "etherpk-verify-test-"));
        // Keep npm's cache and logs inside the test's folder, and stop npm reaching the network
        // for update notices.
        process.env.npm_config_cache = join(root, "npm-cache");
        process.env.npm_config_update_notifier = "false";

        sourceDir = join(root, "etherpk-extension-garden");
        mkdirSync(sourceDir);
        writeExtensionSource(sourceDir);
        gitIn(sourceDir, "init", "--quiet", "--initial-branch", "main");
        gitIn(sourceDir, "add", ".");
        gitIn(sourceDir, "commit", "--quiet", "--message", "Garden 1.0.0");
        gitIn(sourceDir, "tag", "v1.0.0");
        commit = gitIn(sourceDir, "rev-parse", "HEAD");

        // A commit without the lockfile, for the test that a lockfile is required.
        gitIn(sourceDir, "rm", "--quiet", "package-lock.json");
        gitIn(sourceDir, "commit", "--quiet", "--message", "Drop the lockfile");
        gitIn(sourceDir, "tag", "no-lockfile");

        // A commit with a pnpm lockfile in its place, for the test of the pnpm install.
        writeFileSync(join(sourceDir, "pnpm-lock.yaml"), PNPM_LOCKFILE);
        gitIn(sourceDir, "add", "pnpm-lock.yaml");
        gitIn(sourceDir, "commit", "--quiet", "--message", "Use pnpm");
        gitIn(sourceDir, "tag", "pnpm-v1.0.0");

        gitIn(sourceDir, "checkout", "--quiet", "v1.0.0");

        // The published package, built and packed from the tag as a Publisher would.
        execFileSync("npm", ["run", "build"], { cwd: sourceDir, stdio: "ignore" });
        published = pack(sourceDir, join(root, "published"));

        // A tampered package: the same release with one built file changed after the build.
        writeFileSync(join(sourceDir, "dist", "main.js"), 'export function activate() {\n    fetch("https://example.com/collect");\n}\n');
        tampered = pack(sourceDir, join(root, "tampered"));
        rmSync(join(sourceDir, "dist"), { recursive: true });

        server = createServer((request, response) => {
            if (request.url === `/${PACKAGE_NAME.replace("/", "%2f")}`) {
                const packument = {
                    name: PACKAGE_NAME,
                    versions: {
                        "1.0.0": {
                            name: PACKAGE_NAME,
                            version: "1.0.0",
                            dist: { integrity: integrityOf(served), tarball: `${registry}${TARBALL_PATH}` },
                        },
                    },
                };
                response.writeHead(200, { "content-type": "application/json" });
                response.end(JSON.stringify(packument));
            } else if (request.url === TARBALL_PATH) {
                response.writeHead(200, { "content-type": "application/octet-stream" });
                response.end(served);
            } else {
                response.writeHead(404);
                response.end();
            }
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        registry = `http://127.0.0.1:${server.address().port}`;
    });

    after(() => {
        server?.closeAllConnections();
        server?.close();
        if (root) rmSync(root, { recursive: true, force: true });
    });

    function entryFor(tarball, releaseOverrides = {}) {
        return exampleEntry({
            repository: sourceDir,
            releases: [
                {
                    version: "1.0.0",
                    integrity: integrityOf(tarball),
                    minClientVersion: "0.9.6",
                    source: "v1.0.0",
                    reviewed: "2026-10-11",
                    ...releaseOverrides,
                },
            ],
        });
    }

    async function verify(entry) {
        const log = [];
        const result = await verifyRelease({ entry, release: entry.releases[0], registry, log: (line) => log.push(line) });
        return { ...result, log };
    }

    test("a release rebuilt from its tag matches the published package", async () => {
        served = published;
        const result = await verify(entryFor(published));
        assert.deepEqual(result.problems, [], result.log.join("\n"));
        assert.equal(result.ok, true);
        // package.json, README.md and dist/main.js.
        assert.equal(result.files, 3);
        assert.match(result.key, /^[0-9a-f]{32}$/);
    });

    test("a release whose source is a commit id is rebuilt from that commit", async () => {
        served = published;
        const result = await verify(entryFor(published, { source: commit }));
        assert.deepEqual(result.problems, []);
    });

    test("a source with a pnpm lockfile is installed with pnpm", { skip: NO_PNPM }, async () => {
        served = published;
        const result = await verify(entryFor(published, { source: "pnpm-v1.0.0" }));
        assert.deepEqual(result.problems, [], result.log.join("\n"));
        assert.ok(result.log.includes("Installing dependencies with pnpm, with lifecycle scripts off"), result.log.join("\n"));
    });

    test("a tampered tarball fails, naming the file that differs", async () => {
        served = tampered;
        const result = await verify(entryFor(tampered));
        assert.equal(result.ok, false);
        assert.equal(result.problems.length, 1, result.problems.join("\n"));
        assert.match(result.problems[0], /^package\/dist\/main\.js differs \(published \d+ bytes, rebuilt \d+ bytes\)$/);
    });

    test("an integrity the registry does not list fails before the rebuild", async () => {
        served = published;
        const result = await verify(entryFor(published, { integrity: integrityOf(tampered) }));
        assert.equal(result.ok, false);
        assert.match(result.problems[0], /^The registry lists @example\/etherpk-extension-garden@1\.0\.0 with the integrity sha512-/);
        assert.equal(result.log.some((line) => line.startsWith("Fetching v1.0.0")), false);
    });

    test("a minClientVersion that differs from the package's manifest fails", async () => {
        served = published;
        const result = await verify(entryFor(published, { minClientVersion: "0.9.7" }));
        assert.deepEqual(result.problems, [
            'The published package.json has etherpk.minClientVersion "0.9.6", but the release lists "0.9.7"',
        ]);
    });

    test("an entry id that differs from the package's manifest fails", async () => {
        served = published;
        const entry = { ...entryFor(published), id: "orchard" };
        const result = await verify(entry);
        assert.deepEqual(result.problems, ['The published package.json has etherpk.id "garden", but the entry\'s id is "orchard"']);
    });

    test("a source without a lockfile cannot be rebuilt", (t) => {
        const workDir = temporaryDir(t);
        assert.throws(
            () => rebuildFromSource({ repository: sourceDir, source: "no-lockfile", workDir }),
            /has no lockfile\. A release needs a committed pnpm-lock\.yaml or package-lock\.json/,
        );
    });
});
