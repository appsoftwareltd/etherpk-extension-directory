/**
 * The release check: proves that a listed release is the package on npm and that it was built from
 * its tagged source.
 *
 * 1. The registry's record of the package lists the entry's integrity for the version.
 * 2. The tarball the registry serves hashes to that integrity.
 * 3. The package's package.json names the entry's package, version, id and minClientVersion.
 * 4. The source at the release's tag, installed with lifecycle scripts off, built and packed with
 *    `npm pack`, gives the same files, byte for byte, as the published tarball.
 *
 * The fourth step is what makes review worth doing: the reviewer reads source, and the check shows
 * the published bundle came from that source.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { integrityOf, packumentUrl, releaseKey } from "./lib.mjs";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** Environment for every command the check runs, added to the caller's environment. */
const COMMAND_ENV = {
    // A missing or private repository fails at once instead of waiting for a password.
    GIT_TERMINAL_PROMPT: "0",
    // npm's update notice, funding notice and audit each make network requests the check does not need.
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
    // Corepack would otherwise ask before downloading the pnpm version a package names.
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
};

/** How many lines of a failed command's output to show. Build logs can be long. */
const FAILED_OUTPUT_LINES = 40;

/**
 * Runs a command and returns its standard output. Output is captured rather than shown, and the
 * last lines of it are put in the error when the command fails.
 */
export function runCommand(command, args, { cwd } = {}) {
    const result = spawnSync(command, args, {
        cwd,
        env: { ...process.env, ...COMMAND_ENV },
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
        if (result.error.code === "ENOENT") throw new Error(`${command} is not installed, or is not on the PATH`);
        throw result.error;
    }
    if (result.status !== 0) {
        const output = `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-FAILED_OUTPUT_LINES).join("\n");
        const how = result.status === null ? `was stopped by ${result.signal}` : `failed with exit code ${result.status}`;
        throw new Error(`\`${[command, ...args].join(" ")}\` ${how}${output ? `:\n${indent(output)}` : ""}`);
    }
    return result.stdout;
}

function indent(text) {
    return text
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
}

async function fetchOrFail(fetchImpl, url, what, headers = {}) {
    let response;
    try {
        response = await fetchImpl(url, { headers });
    } catch (error) {
        throw new Error(`Could not fetch ${what} from ${url}: ${error.cause?.message ?? error.message}`);
    }
    if (!response.ok) throw new Error(`${url} answered ${response.status} when asked for ${what}`);
    return response;
}

/** Unpacks a gzipped tarball into a new folder with the system `tar`. */
export function unpackTarball(tarball, destination, run = runCommand) {
    mkdirSync(destination, { recursive: true });
    run("tar", ["-xzf", tarball, "-C", destination]);
}

/**
 * Checks the published package.json against the entry and the release. Returns every mismatch.
 */
export function checkManifest(packageJson, entry, release) {
    const problems = [];
    const show = (value) => (value === undefined ? "nothing" : JSON.stringify(value));
    if (packageJson?.name !== entry.package) {
        problems.push(`The published package.json has the name ${show(packageJson?.name)}, but the entry's package is ${show(entry.package)}`);
    }
    if (packageJson?.version !== release.version) {
        problems.push(`The published package.json has the version ${show(packageJson?.version)}, but the release is ${show(release.version)}`);
    }
    const manifest = packageJson?.etherpk;
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
        problems.push("The published package.json has no etherpk manifest");
        return problems;
    }
    if (manifest.id !== entry.id) {
        problems.push(`The published package.json has etherpk.id ${show(manifest.id)}, but the entry's id is ${show(entry.id)}`);
    }
    if (manifest.minClientVersion !== release.minClientVersion) {
        problems.push(
            `The published package.json has etherpk.minClientVersion ${show(manifest.minClientVersion)}, but the release lists ${show(release.minClientVersion)}`,
        );
    }
    return problems;
}

/**
 * Rebuilds a release from its source and returns the path of the tarball `npm pack` made.
 *
 * The check fetches only the one commit, into an empty repository, because `git clone --branch`
 * takes a tag or a branch but not a commit id, and `source` may be any of the three.
 *
 * Dependencies are installed with lifecycle scripts off, so no dependency runs anything while it
 * installs. The package's own `build` script then runs, and `npm pack` runs the package's own
 * `prepack` script if it has one, as it did when the Publisher packed the release.
 */
export function rebuildFromSource({ repository, source, workDir, log = () => {}, run = runCommand }) {
    const sourceDir = join(workDir, "source");
    mkdirSync(sourceDir);

    log(`Fetching ${source} from ${repository}`);
    run("git", ["init", "--quiet"], { cwd: sourceDir });
    // "--" ends the options, so the repository and source are never read as options.
    run("git", ["fetch", "--quiet", "--depth", "1", "--", repository, source], { cwd: sourceDir });
    run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], { cwd: sourceDir });

    const packageJsonPath = join(sourceDir, "package.json");
    if (!existsSync(packageJsonPath)) throw new Error(`The source at ${source} has no package.json at the root of the repository`);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

    let manager;
    if (existsSync(join(sourceDir, "pnpm-lock.yaml"))) {
        manager = "pnpm";
        log("Installing dependencies with pnpm, with lifecycle scripts off");
        run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], { cwd: sourceDir });
    } else if (existsSync(join(sourceDir, "package-lock.json"))) {
        manager = "npm";
        log("Installing dependencies with npm, with lifecycle scripts off");
        run("npm", ["ci", "--ignore-scripts"], { cwd: sourceDir });
    } else {
        throw new Error(
            `The source at ${source} has no lockfile. A release needs a committed pnpm-lock.yaml or package-lock.json, so the rebuild installs the same dependencies the release was built with`,
        );
    }

    if (typeof packageJson.scripts?.build === "string") {
        log(`Running the build script with ${manager}`);
        run(manager, ["run", "build"], { cwd: sourceDir });
    }

    const packDir = join(workDir, "rebuilt-tarball");
    mkdirSync(packDir);
    log("Packing with npm pack");
    run("npm", ["pack", "--pack-destination", packDir], { cwd: sourceDir });
    const tarballs = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
    if (tarballs.length !== 1) throw new Error(`npm pack made ${tarballs.length} tarballs, not one`);
    return join(packDir, tarballs[0]);
}

/**
 * Every file under a folder, as a Map from its path (with "/" separators) to its size and whether it
 * is a regular file. Symbolic links are listed, not followed.
 */
function listFiles(root) {
    const files = new Map();
    const walk = (folder) => {
        for (const dirent of readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, dirent.name);
            if (dirent.isDirectory()) {
                walk(path);
                continue;
            }
            const name = relative(root, path).split(sep).join("/");
            files.set(name, { path, regular: dirent.isFile(), size: dirent.isFile() ? statSync(path).size : 0 });
        }
    };
    walk(root);
    return files;
}

/**
 * Compares the unpacked published package with the unpacked rebuild. Both must hold the same paths,
 * every one a regular file, with the same bytes. Returns the number of files in the published
 * package and one line for each difference.
 */
export function compareTrees(publishedRoot, rebuiltRoot) {
    const published = listFiles(publishedRoot);
    const rebuilt = listFiles(rebuiltRoot);
    const paths = [...new Set([...published.keys(), ...rebuilt.keys()])].sort();
    const differences = [];
    for (const path of paths) {
        const a = published.get(path);
        const b = rebuilt.get(path);
        if (b === undefined) {
            differences.push(`${path} is only in the published package (${a.size} bytes)`);
        } else if (a === undefined) {
            differences.push(`${path} is only in the rebuild (${b.size} bytes)`);
        } else if (!a.regular || !b.regular) {
            differences.push(`${path} is not a regular file in the ${a.regular ? "rebuild" : "published package"}`);
        } else if (a.size !== b.size || !readFileSync(a.path).equals(readFileSync(b.path))) {
            differences.push(`${path} differs (published ${a.size} bytes, rebuilt ${b.size} bytes)`);
        }
    }
    return { files: published.size, differences };
}

/**
 * Runs the whole release check for one release of a valid entry. Returns
 * `{ ok, problems, files, key }`: `problems` lists everything that failed, and `files` is the number
 * of files compared.
 *
 * `registry` is the npm registry to ask, and `fetch` and `log` can be replaced in tests. With
 * `keepWorkDir`, the downloaded, rebuilt and unpacked files are kept for inspection.
 */
export async function verifyRelease({
    entry,
    release,
    registry = DEFAULT_REGISTRY,
    fetch: fetchImpl = globalThis.fetch,
    log = () => {},
    keepWorkDir = false,
}) {
    const problems = [];
    const result = (files = 0) => ({ ok: problems.length === 0, problems, files, key: releaseKey(release.integrity) });
    const workDir = mkdtempSync(join(tmpdir(), "etherpk-verify-"));
    const name = `${entry.package}@${release.version}`;

    try {
        // The registry's record of the package. npm's abbreviated form is enough: it has dist.
        const url = packumentUrl(registry, entry.package);
        log(`Fetching the registry's record of ${entry.package}`);
        const response = await fetchOrFail(fetchImpl, url, `the record of ${entry.package}`, {
            accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8",
        });
        let packument;
        try {
            packument = await response.json();
        } catch {
            throw new Error(`${url} did not answer with JSON`);
        }
        const published = packument?.versions?.[release.version];
        if (published === undefined) {
            problems.push(`${registry} has no version ${release.version} of ${entry.package}`);
            return result();
        }
        if (published.dist?.integrity !== release.integrity) {
            problems.push(`The registry lists ${name} with the integrity ${published.dist?.integrity ?? "(none)"}, but the entry lists ${release.integrity}`);
            return result();
        }

        // The published tarball, which must hash to the listed integrity.
        const tarballUrl = published.dist?.tarball;
        if (typeof tarballUrl !== "string") {
            problems.push(`The registry gives no tarball address for ${name}`);
            return result();
        }
        log(`Downloading ${tarballUrl}`);
        const tarball = Buffer.from(await (await fetchOrFail(fetchImpl, tarballUrl, `the tarball of ${name}`)).arrayBuffer());
        const downloadedIntegrity = integrityOf(tarball);
        if (downloadedIntegrity !== release.integrity) {
            problems.push(`The tarball at ${tarballUrl} hashes to ${downloadedIntegrity}, but the entry lists ${release.integrity}`);
            return result();
        }
        const tarballPath = join(workDir, "published.tgz");
        writeFileSync(tarballPath, tarball);

        // The package's own package.json, checked before the slower rebuild.
        log("Checking the published package.json");
        const manifestDir = join(workDir, "published-manifest");
        unpackTarball(tarballPath, manifestDir);
        const packageJsonPath = join(manifestDir, "package", "package.json");
        if (!existsSync(packageJsonPath)) {
            problems.push("The published tarball has no package/package.json");
            return result();
        }
        problems.push(...checkManifest(JSON.parse(readFileSync(packageJsonPath, "utf8")), entry, release));

        // The rebuild from source.
        const rebuiltTarball = rebuildFromSource({ repository: entry.repository, source: release.source, workDir, log });

        // The build ran the package's own code, which could write anywhere in the work folder. So
        // the published files are unpacked again only now, from the bytes held in memory whose hash
        // was checked, into a folder that did not exist while the build ran.
        log("Comparing the published package with the rebuild");
        const comparedTarball = join(workDir, "published-compared.tgz");
        writeFileSync(comparedTarball, tarball);
        const publishedDir = join(workDir, "published");
        const rebuiltDir = join(workDir, "rebuilt");
        unpackTarball(comparedTarball, publishedDir);
        unpackTarball(rebuiltTarball, rebuiltDir);
        const comparison = compareTrees(publishedDir, rebuiltDir);
        problems.push(...comparison.differences);
        return result(comparison.files);
    } catch (error) {
        problems.push(error.message);
        return result();
    } finally {
        if (keepWorkDir) log(`Kept the working files in ${workDir}`);
        else rmSync(workDir, { recursive: true, force: true });
    }
}
