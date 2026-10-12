import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { loadExtensions, readEntryFiles, validateEntries, validateEntry } from "../scripts/lib.mjs";
import { exampleEntry, exampleIntegrity, exampleRelease, temporaryDir, writeJson } from "./helpers.mjs";

const FILE = "extensions/garden.json";

/** The example entry with one release changed. */
function withRelease(overrides) {
    return exampleEntry({ releases: [exampleRelease("1.2.0", overrides)] });
}

/** The example entry with one key removed. */
function without(key) {
    const entry = exampleEntry();
    delete entry[key];
    return entry;
}

/** The example release with one key removed. */
function releaseWithout(key) {
    const release = exampleRelease();
    delete release[key];
    return release;
}

/** The example release's integrity with its last significant base64 character changed. */
function nonCanonicalIntegrity() {
    const integrity = exampleIntegrity("garden 1.2.0");
    // The 86th base64 character holds two bits of the last byte and four zero bits. "B" sets one of
    // the zero bits, so the string decodes to the same 64 bytes but is not their canonical form.
    return `${integrity.slice(0, -3)}B==`;
}

describe("validateEntry", () => {
    test("a valid entry has no problems", () => {
        assert.deepEqual(validateEntry(exampleEntry(), FILE), []);
    });

    test("accepts an unscoped package, a licence expression and several releases", () => {
        const entry = exampleEntry({
            package: "etherpk-extension-garden",
            license: "(MIT OR Apache-2.0)",
            releases: [exampleRelease("1.10.0"), exampleRelease("1.9.0", { source: "4f1c2a9e" })],
        });
        assert.deepEqual(validateEntry(entry, FILE), []);
    });

    const cases = [
        ["the file name differs from the id", exampleEntry(), "extensions/orchard.json", 'must be named garden.json, after its id'],
        ["an id with capitals", exampleEntry({ id: "Garden" }), "extensions/Garden.json", "id must be lower-case letters"],
        ["an id starting with a digit", exampleEntry({ id: "1garden" }), "extensions/1garden.json", "id must be lower-case letters"],
        ["an id with an underscore", exampleEntry({ id: "gar_den" }), "extensions/gar_den.json", "id must be lower-case letters"],
        ["a built-in id: graph-view", exampleEntry({ id: "graph-view" }), "extensions/graph-view.json", "is the id of an extension built into the Client"],
        ["a built-in id: kanban", exampleEntry({ id: "kanban" }), "extensions/kanban.json", "is the id of an extension built into the Client"],
        ["a built-in id: maps", exampleEntry({ id: "maps" }), "extensions/maps.json", "is the id of an extension built into the Client"],
        ["a fence word the Client draws: mermaid", exampleEntry({ id: "mermaid" }), "extensions/mermaid.json", "names a block the Client draws itself"],
        ["a fence word the Client draws: map", exampleEntry({ id: "map" }), "extensions/map.json", "names a block the Client draws itself"],
        ["an id under etherpk", exampleEntry({ id: "etherpk-garden" }), "extensions/etherpk-garden.json", "starts with etherpk, which is EtherPK's own"],
        ["a publisher named EtherPK", exampleEntry({ publisher: "EtherPK" }), FILE, "publisher names EtherPK or App Software"],
        ["a publisher named App Software", exampleEntry({ publisher: "App Software Ltd" }), FILE, "publisher names EtherPK or App Software"],
        ["a display name with EtherPK in it", exampleEntry({ displayName: "Ether PK Garden" }), FILE, "displayName names EtherPK or App Software"],
        ["no id", without("id"), FILE, "id is required"],
        ["no displayName", without("displayName"), FILE, "displayName is required"],
        ["a displayName that is not a string", exampleEntry({ displayName: 7 }), FILE, "displayName must be a string"],
        ["an empty publisher", exampleEntry({ publisher: "  " }), FILE, "publisher must not be empty"],
        ["a publisher with spaces around it", exampleEntry({ publisher: " example" }), FILE, "publisher must not start or end with spaces"],
        ["a description of two lines", exampleEntry({ description: "Plants.\nAnd seeds." }), FILE, "description must be one line"],
        ["no description", without("description"), FILE, "description is required"],
        ["an http repository", exampleEntry({ repository: "http://github.com/example/garden" }), FILE, "repository must be an https:// URL"],
        ["a repository that is not a URL", exampleEntry({ repository: "github.com/example/garden" }), FILE, "repository must be an https:// URL"],
        ["a repository with a password in it", exampleEntry({ repository: "https://me:secret@github.com/example/garden" }), FILE, "repository must be an https:// URL"],
        ["a licence that is not an identifier", exampleEntry({ license: "Free to use!" }), FILE, "license must be an SPDX licence identifier"],
        ["a licence expression missing an operand", exampleEntry({ license: "MIT OR" }), FILE, "license must be an SPDX licence identifier"],
        ["UNLICENSED", exampleEntry({ license: "UNLICENSED" }), FILE, "license must name an open-source licence"],
        ["a package name with capitals", exampleEntry({ package: "@example/Garden" }), FILE, "package must be a valid npm package name"],
        ["a package name with an empty scope name", exampleEntry({ package: "@example/" }), FILE, "package must be a valid npm package name"],
        ["a package name starting with a dot", exampleEntry({ package: ".garden" }), FILE, "package must be a valid npm package name"],
        ["a package name over 214 characters", exampleEntry({ package: "g".repeat(215) }), FILE, "package must be a valid npm package name"],
        ["no releases", without("releases"), FILE, "releases is required"],
        ["releases that are not an array", exampleEntry({ releases: {} }), FILE, "releases must be an array"],
        ["an empty releases array", exampleEntry({ releases: [] }), FILE, "releases must list at least one release"],
        ["a release that is not an object", exampleEntry({ releases: ["1.2.0"] }), FILE, "releases[0] must be an object"],
        ["a version with two parts", withRelease({ version: "1.2" }), FILE, "releases[0].version must be x.y.z"],
        ["a prerelease version", withRelease({ version: "1.2.0-beta.1" }), FILE, "releases[0].version must be x.y.z"],
        ["a version with a leading zero", withRelease({ version: "1.02.0" }), FILE, "releases[0].version must be x.y.z"],
        ["a sha1 integrity", withRelease({ integrity: "sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk=" }), FILE, "releases[0].integrity must be"],
        ["an integrity of 63 bytes", withRelease({ integrity: `sha512-${Buffer.alloc(63, 7).toString("base64")}` }), FILE, "releases[0].integrity must be"],
        ["an integrity that is not canonical base64", withRelease({ integrity: nonCanonicalIntegrity() }), FILE, "releases[0].integrity must be"],
        ["a minClientVersion with two parts", withRelease({ minClientVersion: "0.9" }), FILE, "releases[0].minClientVersion must be x.y.z"],
        ["an empty source", withRelease({ source: "" }), FILE, "releases[0].source must not be empty"],
        ["a source starting with a hyphen", withRelease({ source: "-v1.2.0" }), FILE, "releases[0].source must be the git tag or commit"],
        ["a source that is a refspec", withRelease({ source: "v1.2.0:refs/heads/main" }), FILE, "releases[0].source must be the git tag or commit"],
        ["a reviewed date in another format", withRelease({ reviewed: "11/10/2026" }), FILE, "releases[0].reviewed must be a date written YYYY-MM-DD"],
        ["a reviewed date in month 13", withRelease({ reviewed: "2026-13-01" }), FILE, "releases[0].reviewed must be a date written YYYY-MM-DD"],
        ["a reviewed date of 30 February", withRelease({ reviewed: "2026-02-30" }), FILE, "releases[0].reviewed must be a date written YYYY-MM-DD"],
        ["no reviewed date", exampleEntry({ releases: [releaseWithout("reviewed")] }), FILE, "releases[0].reviewed is required"],
        ["no integrity", exampleEntry({ releases: [releaseWithout("integrity")] }), FILE, "releases[0].integrity is required"],
        [
            "two releases with the same version",
            exampleEntry({ releases: [exampleRelease("1.2.0"), exampleRelease("1.2.0", { integrity: exampleIntegrity("other") })] }),
            FILE,
            "releases[1].version repeats 1.2.0, already listed at releases[0]",
        ],
        [
            "two releases with the same integrity",
            exampleEntry({ releases: [exampleRelease("1.2.0"), exampleRelease("1.3.0", { integrity: exampleIntegrity("garden 1.2.0") })] }),
            FILE,
            "releases[1].integrity repeats the integrity of releases[0]",
        ],
        ["an unknown key in the entry", exampleEntry({ homepage: "https://example.com" }), FILE, 'unknown key "homepage"'],
        ["an unknown key in a release", withRelease({ notes: "Bug fixes" }), FILE, 'releases[0] has an unknown key "notes"'],
        // A self-hoster's directory may give a package's address. This one's come from npm only.
        ["a package address in a release", withRelease({ tarball: "garden-1.2.0.tgz" }), FILE, 'releases[0] has an unknown key "tarball"'],
        ["an array instead of an object", [exampleEntry()], FILE, "must hold one JSON object"],
    ];

    for (const [name, entry, file, expected] of cases) {
        test(`refuses ${name}`, () => {
            const problems = validateEntry(entry, file);
            assert.ok(
                problems.some((problem) => problem.startsWith(`${file}: `) && problem.includes(expected)),
                `expected a problem containing ${JSON.stringify(expected)}, got:\n${problems.join("\n")}`,
            );
        });
    }

    test("lists every problem, not only the first", () => {
        const problems = validateEntry(exampleEntry({ displayName: "", license: "UNLICENSED", releases: [exampleRelease("1.2")] }), FILE);
        assert.equal(problems.length, 3, problems.join("\n"));
    });
});

describe("validateEntries", () => {
    test("refuses two entries with the same id", () => {
        const problems = validateEntries([
            { file: "extensions/garden.json", entry: exampleEntry() },
            { file: "more/garden.json", entry: exampleEntry({ package: "@example/garden-two" }) },
        ]);
        assert.deepEqual(problems, ['more/garden.json: id "garden" is already used by extensions/garden.json']);
    });

    test("refuses two entries with the same package", () => {
        const problems = validateEntries([
            { file: "extensions/garden.json", entry: exampleEntry() },
            { file: "extensions/orchard.json", entry: exampleEntry({ id: "orchard" }) },
        ]);
        assert.deepEqual(problems, ['extensions/orchard.json: package "@example/etherpk-extension-garden" is already used by extensions/garden.json']);
    });
});

describe("reading extensions/", () => {
    test("an empty folder with only .gitkeep is valid", (t) => {
        const extensionsDir = join(temporaryDir(t), "extensions");
        writeJson(join(extensionsDir, "garden.json"), exampleEntry());
        writeFileSync(join(extensionsDir, ".gitkeep"), "");
        assert.deepEqual(loadExtensions(extensionsDir).problems, []);
        assert.equal(loadExtensions(extensionsDir).entries.length, 1);
    });

    test("reports a file that is not JSON and a file that is not an entry", (t) => {
        const extensionsDir = join(temporaryDir(t), "extensions");
        writeJson(join(extensionsDir, "garden.json"), exampleEntry());
        writeFileSync(join(extensionsDir, "orchard.json"), "{ not json");
        writeFileSync(join(extensionsDir, "notes.txt"), "water the beans");
        const { files, problems } = readEntryFiles(extensionsDir);
        assert.equal(files.length, 1);
        assert.equal(problems.length, 2);
        assert.match(problems[0], /^extensions\/notes\.txt: only <id>\.json files belong in extensions\/$/);
        assert.match(problems[1], /^extensions\/orchard\.json: is not valid JSON/);
    });

    test("a missing extensions folder has no entries", (t) => {
        assert.deepEqual(loadExtensions(join(temporaryDir(t), "extensions")), { entries: [], problems: [] });
    });
});
