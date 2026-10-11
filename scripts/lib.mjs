/**
 * Shared helpers for the directory's scripts: reading and checking the entries in extensions/,
 * building directory.json from them, comparing versions, working out a release's key, and finding
 * the releases a pull request adds or changes.
 *
 * The scripts use only Node's own modules and the system `git`, so checking an entry needs no
 * install step.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The root of this repository, found from this file's location so a script runs from any folder. */
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const EXTENSIONS_DIR = join(REPOSITORY_ROOT, "extensions");
export const DIRECTORY_FILE = join(REPOSITORY_ROOT, "directory.json");

/** The `version` field of directory.json. Change it only when older Clients could not read the new format. */
export const DIRECTORY_FORMAT_VERSION = 1;

/**
 * Ids of the extensions built into the Client. A directory extension with one of these ids would
 * clash with the built-in one, so the directory refuses them.
 */
export const BUILT_IN_EXTENSION_IDS = Object.freeze(["graph-view", "kanban", "maps"]);

/** Every key an entry may have, in the order directory.json writes them. */
export const ENTRY_KEYS = Object.freeze([
    "id",
    "displayName",
    "publisher",
    "description",
    "repository",
    "license",
    "package",
    "releases",
]);

/** Every key a release may have. */
export const RELEASE_KEYS = Object.freeze(["version", "integrity", "minClientVersion", "source", "reviewed"]);

/**
 * The release keys directory.json carries. `source` and `reviewed` are for reviewers and CI, and the
 * Client has no use for them.
 */
const LISTED_RELEASE_KEYS = Object.freeze(["version", "integrity", "minClientVersion"]);

/**
 * The release keys whose change means the release must be rebuilt and compared again. A change to
 * `reviewed` alone does not change which bytes are listed or where they came from.
 */
const REBUILD_RELEASE_KEYS = Object.freeze(["integrity", "minClientVersion", "source"]);

/**
 * The entry keys whose change means every release of the entry must be checked again, because the
 * release check compares the package's name with `package` and rebuilds from `repository`.
 */
const REBUILD_ENTRY_KEYS = Object.freeze(["package", "repository"]);

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

// x.y.z with digits only. Leading zeros are refused, as semver and npm refuse them, so "1.02.0"
// cannot sit beside "1.2.0" as a different release.
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const INTEGRITY_PREFIX = "sha512-";
const SHA512_BYTES = 64;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// npm's rules for a new package name: an optional "@scope/", then lower-case letters, digits, ".",
// "_" and "-", not starting with "." or "_", and at most 214 characters in all.
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/;
const PACKAGE_NAME_MAX_LENGTH = 214;

// One SPDX licence identifier, such as "MIT", "Apache-2.0", "GPL-3.0+" or "LicenseRef-Garden".
const SPDX_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*\+?$/;

// A git tag, branch or commit id. The release check passes `source` to `git fetch` as the thing to
// fetch, so characters that would make it a refspec (":", a leading "+" or "^") or an option (a
// leading "-") are refused.
const SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/+-]*$/;

/* ------------------------------------------------------------------------------------------------
 * Small value checks, shared by validation and the release check.
 * --------------------------------------------------------------------------------------------- */

export function isExtensionId(value) {
    return typeof value === "string" && ID_PATTERN.test(value);
}

export function isVersion(value) {
    return typeof value === "string" && VERSION_PATTERN.test(value);
}

/**
 * True when `value` is "sha512-" followed by the base64 of exactly 64 bytes, the form npm gives a
 * package's `dist.integrity`.
 */
export function isIntegrity(value) {
    if (typeof value !== "string" || !value.startsWith(INTEGRITY_PREFIX)) return false;
    const encoded = value.slice(INTEGRITY_PREFIX.length);
    // Buffer.from skips characters outside the base64 alphabet instead of failing, so decode and
    // encode again: only the one canonical spelling of exactly 64 bytes comes back unchanged.
    const bytes = Buffer.from(encoded, "base64");
    return bytes.length === SHA512_BYTES && bytes.toString("base64") === encoded;
}

/** The integrity string npm would give these bytes: "sha512-" and the base64 of their SHA-512 digest. */
export function integrityOf(bytes) {
    return INTEGRITY_PREFIX + createHash("sha512").update(bytes).digest("base64");
}

/**
 * A release's key: the first 32 lower-case hexadecimal characters of the SHA-512 digest its
 * integrity holds. The Client serves a release at /extensions/<id>/<key>/, so the address names
 * the reviewed bytes. directory.json does not carry the key, because the Client works it out.
 */
export function releaseKey(integrity) {
    if (!isIntegrity(integrity)) {
        throw new TypeError(`Not a sha512 integrity: ${JSON.stringify(integrity)}`);
    }
    const digest = Buffer.from(integrity.slice(INTEGRITY_PREFIX.length), "base64");
    return digest.toString("hex").slice(0, 32);
}

/**
 * Compares two x.y.z versions by number, so "1.10.0" is newer than "1.9.0". Returns a negative
 * number when `a` is older, a positive number when it is newer, and 0 when they are equal.
 */
export function compareVersions(a, b) {
    // BigInt, so a part with more digits than a double holds still compares exactly.
    const partsA = a.split(".").map(BigInt);
    const partsB = b.split(".").map(BigInt);
    for (let index = 0; index < 3; index += 1) {
        if (partsA[index] !== partsB[index]) return partsA[index] < partsB[index] ? -1 : 1;
    }
    return 0;
}

/** The registry address of a package's record (its "packument"). A scoped name's "/" is written "%2f". */
export function packumentUrl(registry, packageName) {
    return `${registry.replace(/\/+$/, "")}/${packageName.replace("/", "%2f")}`;
}

/* ------------------------------------------------------------------------------------------------
 * Validating entries.
 * --------------------------------------------------------------------------------------------- */

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value quoted for a message, cut short so one long value cannot flood the output. */
function show(value) {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function isCalendarDate(value) {
    const match = DATE_PATTERN.exec(value);
    if (!match) return false;
    const [year, month, day] = match.slice(1).map(Number);
    // Date.UTC rolls an impossible day over into the next month, so 2026-02-30 comes back as a
    // different date and is refused.
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isHttpsUrl(value) {
    if (!value.startsWith("https://") || /\s/.test(value)) return false;
    try {
        const url = new URL(value);
        // A URL with a user name or password in it is refused, since the entry is public.
        return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === "";
    } catch {
        return false;
    }
}

/**
 * True for an SPDX licence identifier or a simple expression of them, such as "MIT" or
 * "(MIT OR Apache-2.0)". It checks the shape only, not that each identifier is on the SPDX list.
 */
function looksLikeSpdxExpression(value) {
    let depth = 0;
    for (const character of value) {
        if (character === "(") depth += 1;
        if (character === ")") depth -= 1;
        if (depth < 0) return false;
    }
    if (depth !== 0) return false;
    const tokens = value.replace(/[()]/g, " ").trim().split(/\s+/);
    // Identifiers and operators take turns: identifier, operator, identifier, and so on.
    return (
        tokens.length % 2 === 1 &&
        tokens.every((token, index) => (index % 2 === 0 ? SPDX_ID_PATTERN.test(token) : /^(AND|OR|WITH)$/.test(token)))
    );
}

function isPackageName(value) {
    return value.length <= PACKAGE_NAME_MAX_LENGTH && PACKAGE_NAME_PATTERN.test(value);
}

function isSource(value) {
    return SOURCE_PATTERN.test(value) && !value.includes("..") && !value.endsWith("/") && !value.endsWith(".");
}

function reportUnknownKeys(object, allowed, path, report) {
    for (const key of Object.keys(object)) {
        if (!allowed.includes(key)) report(path, `${path ? "has an " : ""}unknown key ${show(key)}`);
    }
}

/**
 * Checks that `object[key]` is a non-empty, one-line string with no spaces around it. Reports the
 * first thing wrong and returns undefined, or returns the string.
 */
function checkString(object, key, prefix, report) {
    const path = `${prefix}${key}`;
    if (!(key in object)) return void report(path, "is required");
    const value = object[key];
    if (typeof value !== "string") return void report(path, `must be a string (found ${show(value)})`);
    if (value.trim() === "") return void report(path, "must not be empty");
    if (/[\r\n]/.test(value)) return void report(path, "must be one line");
    if (value.trim() !== value) return void report(path, "must not start or end with spaces");
    return value;
}

/**
 * Checks one entry against the directory's rules. `file` is the entry's path for messages, such
 * as "extensions/garden.json", and its file name must be the entry's id. Returns every problem
 * found, each a line that starts with `file`.
 */
export function validateEntry(entry, file) {
    const problems = [];
    const report = (path, message) => problems.push(`${file}: ${path ? `${path} ` : ""}${message}`);

    if (!isPlainObject(entry)) {
        report("", "must hold one JSON object");
        return problems;
    }
    reportUnknownKeys(entry, ENTRY_KEYS, "", report);

    const id = checkString(entry, "id", "", report);
    if (id !== undefined) {
        if (!ID_PATTERN.test(id)) {
            report("id", `must be lower-case letters, digits and hyphens, starting with a letter (found ${show(id)})`);
        } else if (BUILT_IN_EXTENSION_IDS.includes(id)) {
            report("id", `${show(id)} is the id of an extension built into the Client`);
        }
        if (basename(file) !== `${id}.json`) report("", `must be named ${id}.json, after its id`);
    }

    checkString(entry, "displayName", "", report);
    checkString(entry, "publisher", "", report);
    checkString(entry, "description", "", report);

    const repository = checkString(entry, "repository", "", report);
    if (repository !== undefined && !isHttpsUrl(repository)) {
        report("repository", `must be an https:// URL (found ${show(repository)})`);
    }

    const license = checkString(entry, "license", "", report);
    if (license === "UNLICENSED") {
        report("license", "must name an open-source licence, not UNLICENSED");
    } else if (license !== undefined && !looksLikeSpdxExpression(license)) {
        report("license", `must be an SPDX licence identifier, such as MIT or Apache-2.0 (found ${show(license)})`);
    }

    const packageName = checkString(entry, "package", "", report);
    if (packageName !== undefined && !isPackageName(packageName)) {
        report("package", `must be a valid npm package name, such as @example/etherpk-extension-garden (found ${show(packageName)})`);
    }

    if (!("releases" in entry)) {
        report("releases", "is required");
    } else if (!Array.isArray(entry.releases)) {
        report("releases", "must be an array");
    } else if (entry.releases.length === 0) {
        report("releases", "must list at least one release");
    } else {
        validateReleases(entry.releases, report);
    }
    return problems;
}

function validateReleases(releases, report) {
    // Where each version and integrity was first seen, to name the earlier release in a repeat.
    const versionsSeen = new Map();
    const integritiesSeen = new Map();

    releases.forEach((release, index) => {
        const at = `releases[${index}]`;
        if (!isPlainObject(release)) return void report(at, "must be an object");
        reportUnknownKeys(release, RELEASE_KEYS, at, report);
        const prefix = `${at}.`;

        const version = checkString(release, "version", prefix, report);
        if (version !== undefined && !VERSION_PATTERN.test(version)) {
            report(`${prefix}version`, `must be x.y.z with digits only, such as 1.2.0 (found ${show(version)})`);
        } else if (version !== undefined) {
            if (versionsSeen.has(version)) {
                report(`${prefix}version`, `repeats ${version}, already listed at releases[${versionsSeen.get(version)}]`);
            } else {
                versionsSeen.set(version, index);
            }
        }

        const integrity = checkString(release, "integrity", prefix, report);
        if (integrity !== undefined && !isIntegrity(integrity)) {
            report(`${prefix}integrity`, `must be "sha512-" followed by the base64 of a 64-byte digest, as npm's dist.integrity is (found ${show(integrity)})`);
        } else if (integrity !== undefined) {
            if (integritiesSeen.has(integrity)) {
                report(`${prefix}integrity`, `repeats the integrity of releases[${integritiesSeen.get(integrity)}]`);
            } else {
                integritiesSeen.set(integrity, index);
            }
        }

        const minClientVersion = checkString(release, "minClientVersion", prefix, report);
        if (minClientVersion !== undefined && !VERSION_PATTERN.test(minClientVersion)) {
            report(`${prefix}minClientVersion`, `must be x.y.z with digits only, such as 0.9.6 (found ${show(minClientVersion)})`);
        }

        const source = checkString(release, "source", prefix, report);
        if (source !== undefined && !isSource(source)) {
            report(`${prefix}source`, `must be the git tag or commit the release was built from, such as v1.2.0 (found ${show(source)})`);
        }

        const reviewed = checkString(release, "reviewed", prefix, report);
        if (reviewed !== undefined && !isCalendarDate(reviewed)) {
            report(`${prefix}reviewed`, `must be a date written YYYY-MM-DD (found ${show(reviewed)})`);
        }
    });
}

/**
 * Checks every entry, and that no two entries share an id or a package. `files` is a list of
 * `{ file, entry }`. Returns every problem found.
 */
export function validateEntries(files) {
    const problems = [];
    const owners = { id: new Map(), package: new Map() };
    for (const { file, entry } of files) {
        problems.push(...validateEntry(entry, file));
        if (!isPlainObject(entry)) continue;
        for (const key of ["id", "package"]) {
            const value = entry[key];
            if (typeof value !== "string" || value === "") continue;
            const owner = owners[key].get(value);
            if (owner) problems.push(`${file}: ${key} ${show(value)} is already used by ${owner}`);
            else owners[key].set(value, file);
        }
    }
    return problems;
}

/**
 * Reads every file in an extensions folder. Returns the parsed entries as `{ file, entry }` and the
 * problems found on the way: a file that is not JSON, or anything other than <id>.json files
 * (and the .gitkeep that keeps the empty folder in git).
 */
export function readEntryFiles(extensionsDir) {
    const files = [];
    const problems = [];
    if (!existsSync(extensionsDir)) return { files, problems };
    const folder = basename(extensionsDir);
    const dirents = readdirSync(extensionsDir, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name));
    for (const dirent of dirents) {
        if (dirent.name === ".gitkeep") continue;
        const file = `${folder}/${dirent.name}`;
        if (!dirent.isFile() || !dirent.name.endsWith(".json")) {
            problems.push(`${file}: only <id>.json files belong in ${folder}/`);
            continue;
        }
        try {
            files.push({ file, entry: JSON.parse(readFileSync(join(extensionsDir, dirent.name), "utf8")) });
        } catch (error) {
            problems.push(`${file}: is not valid JSON (${error.message})`);
        }
    }
    return { files, problems };
}

/** Reads and checks every entry. Returns the entries and every problem found. */
export function loadExtensions(extensionsDir = EXTENSIONS_DIR) {
    const { files, problems } = readEntryFiles(extensionsDir);
    problems.push(...validateEntries(files));
    return { entries: files.map(({ entry }) => entry), problems };
}

/**
 * Reads one release for the release check. The id is checked before it becomes part of a path, and
 * the whole entry is validated, so the release check never acts on an entry CI would refuse.
 */
export function readRelease(id, version, extensionsDir = EXTENSIONS_DIR) {
    if (!isExtensionId(id)) return { problems: [`${show(id)} is not an extension id`] };
    const file = `${basename(extensionsDir)}/${id}.json`;
    const path = join(extensionsDir, `${id}.json`);
    if (!existsSync(path)) return { problems: [`${file} does not exist`] };
    let entry;
    try {
        entry = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        return { problems: [`${file}: is not valid JSON (${error.message})`] };
    }
    const problems = validateEntry(entry, file);
    if (problems.length > 0) return { problems };
    const release = entry.releases.find((candidate) => candidate.version === version);
    if (!release) {
        const listed = entry.releases.map((candidate) => candidate.version).join(", ");
        return { problems: [`${file} lists no release ${show(version)} (it lists ${listed})`] };
    }
    return { entry, release, problems: [] };
}

/* ------------------------------------------------------------------------------------------------
 * Building directory.json.
 * --------------------------------------------------------------------------------------------- */

/** Compares by UTF-16 code unit, which gives the same order on every machine, unlike localeCompare. */
function compareText(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

/**
 * The value of directory.json for a set of valid entries: extensions sorted by id, each extension's
 * releases newest first, and only the fields the Client reads. The entries are not changed.
 */
export function buildDirectory(entries) {
    const extensions = [...entries]
        .sort((a, b) => compareText(a.id, b.id))
        .map((entry) => {
            const extension = {};
            for (const key of ENTRY_KEYS) {
                if (key !== "releases") extension[key] = entry[key];
            }
            extension.releases = [...entry.releases]
                .sort((a, b) => compareVersions(b.version, a.version))
                .map((release) => Object.fromEntries(LISTED_RELEASE_KEYS.map((key) => [key, release[key]])));
            return extension;
        });
    return { version: DIRECTORY_FORMAT_VERSION, extensions };
}

/** directory.json's exact text. The same entries always give the same bytes. */
export function renderDirectory(entries) {
    return `${JSON.stringify(buildDirectory(entries), null, 2)}\n`;
}

/**
 * Builds directory.json from the entries. With `check`, it writes nothing and reports whether the
 * file on disk is current. Returns `{ status, problems, extensions, releases }`, where `status` is:
 *
 * - "invalid": an entry has a problem, and nothing was written.
 * - "stale": with `check`, the file on disk differs from what the entries build.
 * - "current": the file on disk is already what the entries build.
 * - "written": the file was out of date and has been written.
 */
export function buildIndex({ extensionsDir = EXTENSIONS_DIR, directoryFile = DIRECTORY_FILE, check = false } = {}) {
    const { entries, problems } = loadExtensions(extensionsDir);
    if (problems.length > 0) return { status: "invalid", problems, extensions: 0, releases: 0 };

    const counts = {
        extensions: entries.length,
        releases: entries.reduce((total, entry) => total + entry.releases.length, 0),
    };
    const text = renderDirectory(entries);
    const current = existsSync(directoryFile) ? readFileSync(directoryFile, "utf8") : null;
    if (current === text) return { status: "current", problems: [], ...counts };
    if (check) return { status: "stale", problems: [], ...counts };
    writeFileSync(directoryFile, text);
    return { status: "written", problems: [], ...counts };
}

/* ------------------------------------------------------------------------------------------------
 * Finding the releases a pull request adds or changes.
 * --------------------------------------------------------------------------------------------- */

function git(args, cwd) {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    });
}

/** The entries at a git ref, as a Map from the id in each file's name to the parsed entry. */
export function readEntriesAtRef(ref, cwd = REPOSITORY_ROOT) {
    try {
        // --end-of-options keeps a ref that starts with "-" from being read as an option.
        git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], cwd);
    } catch {
        throw new Error(`Unknown git ref ${show(ref)}. Fetch it first, for example with: git fetch origin main`);
    }
    // -z separates names with NUL bytes, so git prints every file name as it is, without quoting.
    // A ref with no extensions/ folder lists nothing.
    const paths = git(["ls-tree", "-z", "--full-tree", "--name-only", ref, "--", "extensions/"], cwd)
        .split("\0")
        .filter((path) => path.endsWith(".json"));
    const entries = new Map();
    for (const path of paths) {
        const text = git(["show", `${ref}:${path}`], cwd);
        entries.set(basename(path, ".json"), parseEntryText(text, `${ref}:${path}`));
    }
    return entries;
}

/** The entries in the working tree's extensions/ folder, as readEntriesAtRef returns them. */
export function readEntriesInWorkingTree(cwd = REPOSITORY_ROOT) {
    const folder = join(cwd, "extensions");
    const entries = new Map();
    if (!existsSync(folder)) return entries;
    for (const name of readdirSync(folder).filter((candidate) => candidate.endsWith(".json"))) {
        entries.set(basename(name, ".json"), parseEntryText(readFileSync(join(folder, name), "utf8"), `extensions/${name}`));
    }
    return entries;
}

function parseEntryText(text, where) {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${where} is not valid JSON (${error.message})`);
    }
}

function releasesOf(entry) {
    return isPlainObject(entry) && Array.isArray(entry.releases) ? entry.releases.filter(isPlainObject) : [];
}

/**
 * Compares two sets of entries (Maps from id to entry). Returns `changed`, the releases that are new
 * or whose integrity, minClientVersion or source changed, and `removed`, the releases that were
 * taken out. Each is a list of "id@version", sorted by id and then in the order the file lists them.
 *
 * A change to an entry's package or repository marks all its releases as changed, because the
 * release check compares the package name and rebuilds from the repository.
 */
export function diffReleases(baseEntries, headEntries) {
    const changed = [];
    const removed = [];
    const ids = [...new Set([...baseEntries.keys(), ...headEntries.keys()])].sort(compareText);
    for (const id of ids) {
        const base = baseEntries.get(id);
        const head = headEntries.get(id);
        const entryChanged =
            base !== undefined && head !== undefined && REBUILD_ENTRY_KEYS.some((key) => base[key] !== head[key]);
        const baseReleases = new Map(releasesOf(base).map((release) => [release.version, release]));
        const headVersions = new Set();
        for (const release of releasesOf(head)) {
            headVersions.add(release.version);
            const before = baseReleases.get(release.version);
            if (before === undefined || entryChanged || REBUILD_RELEASE_KEYS.some((key) => before[key] !== release[key])) {
                changed.push(`${id}@${release.version}`);
            }
        }
        for (const release of releasesOf(base)) {
            if (!headVersions.has(release.version)) removed.push(`${id}@${release.version}`);
        }
    }
    return { changed, removed };
}

/**
 * The releases that differ between a base ref and either a head ref or, when `head` is not given,
 * the working tree.
 */
export function changedReleases({ cwd = REPOSITORY_ROOT, base = "origin/main", head } = {}) {
    const baseEntries = readEntriesAtRef(base, cwd);
    const headEntries = head === undefined ? readEntriesInWorkingTree(cwd) : readEntriesAtRef(head, cwd);
    return diffReleases(baseEntries, headEntries);
}

/** "1 extension", "2 extensions". */
export function count(number, noun) {
    return `${number} ${noun}${number === 1 ? "" : "s"}`;
}
