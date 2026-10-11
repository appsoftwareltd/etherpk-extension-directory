import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { buildDirectory, buildIndex, compareVersions, renderDirectory } from "../scripts/lib.mjs";
import { exampleEntry, exampleRelease, temporaryDir, writeJson } from "./helpers.mjs";

function orchardEntry() {
    return exampleEntry({
        id: "orchard",
        displayName: "Orchard",
        package: "@example/etherpk-extension-orchard",
        repository: "https://github.com/example/etherpk-extension-orchard",
        releases: [exampleRelease("2.0.0", { integrity: exampleRelease("orchard 2.0.0").integrity })],
    });
}

describe("compareVersions", () => {
    test("compares each part as a number", () => {
        assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
        assert.ok(compareVersions("1.9.0", "1.10.0") < 0);
        assert.ok(compareVersions("2.0.0", "1.99.99") > 0);
        assert.ok(compareVersions("0.0.10", "0.0.9") > 0);
        assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
    });
});

describe("buildDirectory", () => {
    test("sorts extensions by id", () => {
        const directory = buildDirectory([orchardEntry(), exampleEntry()]);
        assert.deepEqual(
            directory.extensions.map((extension) => extension.id),
            ["garden", "orchard"],
        );
    });

    test("lists releases newest first, comparing versions as numbers", () => {
        const entry = exampleEntry({
            releases: ["1.9.0", "1.10.0", "0.12.3", "1.10.1"].map((version) => exampleRelease(version)),
        });
        const [extension] = buildDirectory([entry]).extensions;
        assert.deepEqual(
            extension.releases.map((release) => release.version),
            ["1.10.1", "1.10.0", "1.9.0", "0.12.3"],
        );
    });

    test("keeps only the fields the Client reads, in a fixed order", () => {
        const directory = buildDirectory([exampleEntry()]);
        assert.deepEqual(Object.keys(directory), ["version", "extensions"]);
        assert.equal(directory.version, 1);
        const [extension] = directory.extensions;
        assert.deepEqual(Object.keys(extension), ["id", "displayName", "publisher", "description", "repository", "license", "package", "releases"]);
        assert.deepEqual(extension.releases, [
            { version: "1.2.0", integrity: exampleRelease().integrity, minClientVersion: "0.9.6" },
        ]);
    });

    test("does not change the entries it is given", () => {
        const entries = [orchardEntry(), exampleEntry({ releases: [exampleRelease("1.0.0"), exampleRelease("1.1.0")] })];
        const before = structuredClone(entries);
        buildDirectory(entries);
        assert.deepEqual(entries, before);
    });
});

describe("renderDirectory", () => {
    test("gives the same bytes for the same entries in any order", () => {
        const text = renderDirectory([exampleEntry(), orchardEntry()]);
        assert.equal(renderDirectory([orchardEntry(), exampleEntry()]), text);
        assert.equal(text, `${JSON.stringify(buildDirectory([exampleEntry(), orchardEntry()]), null, 2)}\n`);
    });

    test("an empty directory is version 1 with no extensions", () => {
        assert.equal(renderDirectory([]), '{\n  "version": 1,\n  "extensions": []\n}\n');
    });
});

describe("buildIndex", () => {
    function setUp(t) {
        const root = temporaryDir(t);
        const extensionsDir = join(root, "extensions");
        const directoryFile = join(root, "directory.json");
        writeJson(join(extensionsDir, "garden.json"), exampleEntry());
        return { extensionsDir, directoryFile };
    }

    test("writes directory.json, then finds it current", (t) => {
        const paths = setUp(t);
        assert.equal(buildIndex(paths).status, "written");
        assert.equal(readFileSync(paths.directoryFile, "utf8"), renderDirectory([exampleEntry()]));
        assert.deepEqual(buildIndex({ ...paths, check: true }), { status: "current", problems: [], extensions: 1, releases: 1 });
    });

    test("--check reports a stale directory.json and writes nothing", (t) => {
        const paths = setUp(t);
        buildIndex(paths);
        const built = readFileSync(paths.directoryFile, "utf8");
        writeJson(join(paths.extensionsDir, "garden.json"), exampleEntry({ releases: [exampleRelease("1.3.0"), exampleRelease("1.2.0")] }));
        assert.equal(buildIndex({ ...paths, check: true }).status, "stale");
        assert.equal(readFileSync(paths.directoryFile, "utf8"), built);
    });

    test("--check reports a hand-edited directory.json as stale", (t) => {
        const paths = setUp(t);
        buildIndex(paths);
        writeFileSync(paths.directoryFile, readFileSync(paths.directoryFile, "utf8").replace("Garden", "Gardens"));
        assert.equal(buildIndex({ ...paths, check: true }).status, "stale");
    });

    test("--check reports a missing directory.json as stale", (t) => {
        const paths = setUp(t);
        assert.equal(buildIndex({ ...paths, check: true }).status, "stale");
        assert.equal(existsSync(paths.directoryFile), false);
    });

    test("refuses to write when an entry is invalid", (t) => {
        const paths = setUp(t);
        writeJson(join(paths.extensionsDir, "garden.json"), exampleEntry({ license: "UNLICENSED" }));
        const result = buildIndex(paths);
        assert.equal(result.status, "invalid");
        assert.match(result.problems[0], /license must name an open-source licence/);
        assert.equal(existsSync(paths.directoryFile), false);
    });
});
