import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { changedReleases, diffReleases } from "../scripts/lib.mjs";
import { exampleEntry, exampleIntegrity, exampleRelease, gitIn, hasCommand, temporaryDir, writeJson } from "./helpers.mjs";

const NO_GIT = hasCommand("git") ? false : "git is not installed";

function orchardEntry(releases = [exampleRelease("2.0.0", { integrity: exampleIntegrity("orchard 2.0.0") })]) {
    return exampleEntry({
        id: "orchard",
        displayName: "Orchard",
        package: "@example/etherpk-extension-orchard",
        repository: "https://github.com/example/etherpk-extension-orchard",
        releases,
    });
}

describe("diffReleases", () => {
    test("an empty base lists every release as new", () => {
        const head = new Map([["garden", exampleEntry({ releases: [exampleRelease("1.1.0"), exampleRelease("1.0.0")] })]]);
        assert.deepEqual(diffReleases(new Map(), head), { changed: ["garden@1.1.0", "garden@1.0.0"], removed: [] });
    });

    test("a change to reviewed alone needs no rebuild", () => {
        const base = new Map([["garden", exampleEntry()]]);
        const head = new Map([["garden", exampleEntry({ releases: [exampleRelease("1.2.0", { reviewed: "2026-10-12" })] })]]);
        assert.deepEqual(diffReleases(base, head), { changed: [], removed: [] });
    });

    test("a changed package or repository lists every release of the entry", () => {
        const releases = [exampleRelease("1.1.0"), exampleRelease("1.0.0")];
        const base = new Map([["garden", exampleEntry({ releases })]]);
        for (const change of [{ package: "@example/garden" }, { repository: "https://github.com/example/garden" }]) {
            const head = new Map([["garden", exampleEntry({ releases, ...change })]]);
            assert.deepEqual(diffReleases(base, head).changed, ["garden@1.1.0", "garden@1.0.0"]);
        }
    });
});

describe("changedReleases", { skip: NO_GIT }, () => {
    /**
     * A repository with two commits. The first lists garden 1.0.0, 0.9.0 and 0.8.0. The second adds
     * garden 1.1.0, changes the minClientVersion of 1.0.0, removes 0.9.0, changes only the reviewed
     * date of 0.8.0, and adds orchard 2.0.0.
     */
    function setUp(t) {
        const cwd = temporaryDir(t);
        gitIn(cwd, "init", "--quiet", "--initial-branch", "main");
        writeFileSync(join(cwd, "README.md"), "Example directory\n");
        gitIn(cwd, "add", ".");
        gitIn(cwd, "commit", "--quiet", "--message", "Start");
        const empty = gitIn(cwd, "rev-parse", "HEAD");

        writeJson(join(cwd, "extensions", "garden.json"), exampleEntry({
            releases: [exampleRelease("1.0.0"), exampleRelease("0.9.0"), exampleRelease("0.8.0")],
        }));
        writeFileSync(join(cwd, "extensions", ".gitkeep"), "");
        gitIn(cwd, "add", ".");
        gitIn(cwd, "commit", "--quiet", "--message", "List garden");
        const base = gitIn(cwd, "rev-parse", "HEAD");

        writeJson(join(cwd, "extensions", "garden.json"), exampleEntry({
            releases: [
                exampleRelease("1.1.0"),
                exampleRelease("1.0.0", { minClientVersion: "0.9.7" }),
                exampleRelease("0.8.0", { reviewed: "2026-10-12" }),
            ],
        }));
        writeJson(join(cwd, "extensions", "orchard.json"), orchardEntry());
        gitIn(cwd, "add", ".");
        gitIn(cwd, "commit", "--quiet", "--message", "Garden 1.1.0 and orchard");
        return { cwd, empty, base };
    }

    test("lists new and changed releases between two refs, and reports removed ones", (t) => {
        const { cwd, base } = setUp(t);
        assert.deepEqual(changedReleases({ cwd, base, head: "HEAD" }), {
            changed: ["garden@1.1.0", "garden@1.0.0", "orchard@2.0.0"],
            removed: ["garden@0.9.0"],
        });
    });

    test("compares with the working tree when no head ref is given", (t) => {
        const { cwd } = setUp(t);
        assert.deepEqual(changedReleases({ cwd, base: "HEAD" }), { changed: [], removed: [] });

        writeJson(join(cwd, "extensions", "garden.json"), exampleEntry({
            releases: [
                exampleRelease("1.1.0", { integrity: exampleIntegrity("garden 1.1.0, packed again") }),
                exampleRelease("1.0.0", { minClientVersion: "0.9.7", source: "4f1c2a9e" }),
                exampleRelease("0.8.0", { reviewed: "2026-10-12" }),
            ],
        }));
        rmSync(join(cwd, "extensions", "orchard.json"));
        assert.deepEqual(changedReleases({ cwd, base: "HEAD" }), {
            changed: ["garden@1.1.0", "garden@1.0.0"],
            removed: ["orchard@2.0.0"],
        });
    });

    test("a base without extensions/ lists every release as new", (t) => {
        const { cwd, empty } = setUp(t);
        assert.deepEqual(changedReleases({ cwd, base: empty, head: "HEAD" }).changed, [
            "garden@1.1.0",
            "garden@1.0.0",
            "garden@0.8.0",
            "orchard@2.0.0",
        ]);
    });

    test("an unknown base ref fails with advice", (t) => {
        const { cwd } = setUp(t);
        assert.throws(() => changedReleases({ cwd, base: "origin/main" }), /Unknown git ref "origin\/main"\. Fetch it first/);
    });

    test("an entry that is not JSON fails, naming the file", (t) => {
        const { cwd } = setUp(t);
        writeFileSync(join(cwd, "extensions", "garden.json"), "{ not json");
        assert.throws(() => changedReleases({ cwd, base: "HEAD" }), /extensions\/garden\.json is not valid JSON/);
    });
});
