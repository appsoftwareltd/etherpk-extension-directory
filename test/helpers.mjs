/**
 * Shared test fixtures: an example entry, temporary folders and a git that ignores the user's own
 * git configuration. `node --test` also lists this file as a test file, because it sits in test/.
 * It has no tests of its own.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A valid integrity for made-up bytes. */
export function exampleIntegrity(seed) {
    return `sha512-${createHash("sha512").update(seed).digest("base64")}`;
}

export function exampleRelease(version = "1.2.0", overrides = {}) {
    return {
        version,
        integrity: exampleIntegrity(`garden ${version}`),
        minClientVersion: "0.9.6",
        source: `v${version}`,
        reviewed: "2026-10-11",
        ...overrides,
    };
}

/** A valid entry for the made-up extension "garden". */
export function exampleEntry(overrides = {}) {
    return {
        id: "garden",
        displayName: "Garden",
        publisher: "example",
        description: "Adds a planting calendar to documents.",
        repository: "https://github.com/example/etherpk-extension-garden",
        license: "MIT",
        package: "@example/etherpk-extension-garden",
        releases: [exampleRelease()],
        ...overrides,
    };
}

/** A new temporary folder, removed when the test that made it ends. */
export function temporaryDir(t, prefix = "etherpk-directory-test-") {
    const path = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(path, { recursive: true, force: true }));
    return path;
}

export function writeJson(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

/** True when a command is on the PATH. */
export function hasCommand(command) {
    return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

/**
 * The environment for the tests' own git commands: no global or system configuration, so a
 * developer's commit signing or hooks cannot change what the tests do, and a fixed author.
 */
export const GIT_ENV = {
    ...process.env,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Example",
    GIT_AUTHOR_EMAIL: "example@example.com",
    GIT_COMMITTER_NAME: "Example",
    GIT_COMMITTER_EMAIL: "example@example.com",
};

/** Runs git in a folder and returns its trimmed output. */
export function gitIn(cwd, ...args) {
    return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
