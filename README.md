# EtherPK Extension Directory

This repository lists the extensions that the EtherPK Client can install from Publishers other than EtherPK. Each extension has one file in `extensions/`, and that file lists the releases that a person has reviewed. Each release is named by the integrity hash of its npm package, so a Client installs only the bytes that were reviewed.

An extension runs in the Client's page with no sandbox, and it can read every document that is open on the device. Nothing else checks what an extension does, so every release is reviewed before it is listed.

## How a release is listed

1. The Publisher publishes the release to npm and opens a pull request here that adds the release to the extension's file.
2. CI checks the entry, fetches the package from npm and checks its hash. It then rebuilds the release from its tagged source, and checks that the rebuilt package has the same files as the package on npm, byte for byte.
3. A reviewer reads the source changes since the last listed release and merges the pull request.

[CONTRIBUTING.md](CONTRIBUTING.md) is the guide for Publishers, and [REVIEWING.md](REVIEWING.md) is the checklist for reviewers.

## How the Client uses directory.json

`directory.json` is the list the Client reads. It's built from the files in `extensions/`, and it holds each extension's details and, for each release, its version, integrity and the oldest Client version it runs on.

1. The Client's server reads `directory.json`, and reads it again every ten minutes.
2. When someone installs an extension, the server fetches the listed release from npm and checks that its SHA-512 hash matches the `integrity` in the list. It then serves the files from the Client's own origin.
3. The server checks the current list on every request for a release. When a release is removed from the list, Clients stop serving it within about ten minutes.

The Client serves a release at `/extensions/<id>/<key>/`. The key is the first 32 hexadecimal characters of the SHA-512 digest in the release's `integrity`, so the address always names the same bytes.

The Client reads this repository's list by default, at `https://raw.githubusercontent.com/appsoftwareltd/etherpk-extension-directory/main/directory.json`. A self-hosted Client can read a different list. Set `EXTENSION_DIRECTORY_URL` to the address of that list's `directory.json`. In production the Client installs only extensions from the list it reads, so a self-hoster who wants an extension that isn't listed here can run a directory of their own.

## The format of directory.json

```json
{
  "version": 1,
  "extensions": [
    {
      "id": "garden",
      "displayName": "Garden",
      "publisher": "example",
      "description": "Adds a planting calendar to documents.",
      "repository": "https://github.com/example/etherpk-extension-garden",
      "license": "MIT",
      "package": "@example/etherpk-extension-garden",
      "releases": [
        { "version": "1.2.0", "integrity": "sha512-...", "minClientVersion": "0.9.6" }
      ]
    }
  ]
}
```

Extensions are sorted by id, and each extension's releases are sorted newest first. `npm run build` writes the file, and the same entries always give the same bytes.

A directory you run yourself doesn't need a registry. Its releases can each carry a `tarball` key, the address of the release's package file, absolute or relative to the list's own address (`"tarball": "garden-1.2.0.tgz"`). Then the directory can be plain files on any web server, or a folder on the Client's own machine, with `EXTENSION_DIRECTORY_URL` set to a `file:` address. The Client checks each package against its `integrity` the same way. This repository's releases always come from npm, so its checks refuse a `tarball` key.

## Layout

| Path | What it holds |
| --- | --- |
| `extensions/<id>.json` | One entry for each extension, written by its Publisher. |
| `directory.json` | The list the Client reads, built from `extensions/` by `npm run build`. Don't edit it by hand. |
| `scripts/` | The checks, the build and the release check. |
| `test/` | Tests for the scripts. |
| `.github/workflows/check.yml` | CI for pull requests and for `main`. |

## Commands

The scripts need Node 24 or later, git and tar, and they have no dependencies, so there's nothing to install. The release check also needs npm, and pnpm for an extension that uses pnpm. It runs on Linux and macOS.

| Command | What it does |
| --- | --- |
| `npm run validate` | Checks every entry and lists every problem. |
| `npm run build` | Writes `directory.json` from the entries. |
| `npm run check` | Fails when `directory.json` isn't what the entries build. |
| `npm test` | Runs the tests. They make no network requests. |
| `npm run verify -- <id> <version>` | Runs the release check for one release. `--registry <url>` uses another npm registry, and `--keep` keeps the files it downloaded and built. |
| `node scripts/changed-releases.mjs [base] [head]` | Prints `id@version` for each release that is new or changed between two git refs. The base is `origin/main` unless you give one, and the head is the working tree unless you give one. |

## Licence

The contents of this repository are under the MIT licence. See [LICENSE](LICENSE). Each listed extension has its own licence, named in its entry.
