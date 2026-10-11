# Listing an extension

This guide is for a Publisher who wants an extension listed in the EtherPK Extension Directory. Each release is a pull request to this repository. CI rebuilds the release from its source and compares it with the package on npm, and then a person reads the source and merges.

## What an extension needs

- A public source repository, with a git tag for each release, such as `v1.2.0`. The package's `package.json` is at the root of the repository.
- A committed lockfile, either `pnpm-lock.yaml` or `package-lock.json`. The release check installs from it, and it refuses a release without one.
- An open-source licence, named by its SPDX identifier in `package.json` and in the entry.
- A package on npm that can be built again from the tag. The release check does these steps with the source at the tag, and the result must have the same files as the package on npm, byte for byte:
  1. `pnpm install --frozen-lockfile --ignore-scripts`, or `npm ci --ignore-scripts`.
  2. `pnpm run build` or `npm run build`, when `package.json` has a `build` script.
  3. `npm pack`, which also runs a `prepack` script if there is one.
- An `etherpk` manifest in `package.json`. Its `id` must be the entry's `id`, and its `minClientVersion` must be the release's `minClientVersion`.
- Once EtherPK promotes parts of the Extension API (`@appsoftwareltd/etherpk-extension-api`) to Stable, an extension in the directory may use only those parts.

Dependencies' install scripts don't run in the release check, so a build can't rely on them. A build that writes the date, the time or a path on the build machine into its output also fails the check, because the rebuilt files differ.

## Publishing a release

1. Set the new version in `package.json`, commit it, and push a tag for it.

   ```sh
   git tag v1.2.0
   git push origin v1.2.0
   ```

2. Build and pack from a clean checkout of the tag, with the same commands the release check uses. A clean checkout keeps local files out of the package.

   ```sh
   git clone --branch v1.2.0 https://github.com/example/etherpk-extension-garden garden-release
   cd garden-release
   npm ci --ignore-scripts   # or: pnpm install --frozen-lockfile --ignore-scripts
   npm run build
   npm pack
   ```

3. Publish the tarball that `npm pack` made, not the folder. Then the bytes on npm are the bytes you packed. Add `--access public` the first time you publish a scoped package.

   ```sh
   npm publish example-etherpk-extension-garden-1.2.0.tgz
   ```

4. Read the release's integrity from npm.

   ```sh
   npm view @example/etherpk-extension-garden@1.2.0 dist.integrity
   ```

npm never accepts a second upload of a version, so a published version's integrity can't change.

## Opening the pull request

Open one pull request for each release.

For a first listing, add `extensions/<id>.json`, named after the extension's id:

```json
{
    "id": "garden",
    "displayName": "Garden",
    "publisher": "example",
    "description": "Adds a planting calendar to documents.",
    "repository": "https://github.com/example/etherpk-extension-garden",
    "license": "MIT",
    "package": "@example/etherpk-extension-garden",
    "releases": [
        {
            "version": "1.2.0",
            "integrity": "sha512-...",
            "minClientVersion": "0.9.6",
            "source": "v1.2.0",
            "reviewed": "2026-10-11"
        }
    ]
}
```

| Field | What it holds |
| --- | --- |
| `id` | The extension's id, the same as `etherpk.id` in `package.json`. It has lower-case letters, digits and hyphens, and starts with a letter. `graph-view`, `kanban` and `maps` belong to extensions built into the Client. |
| `displayName` | The name people see. |
| `publisher` | Your name as a Publisher. |
| `description` | One line that says what the extension adds. |
| `repository` | The `https://` address of the public source repository. |
| `license` | The SPDX identifier of the licence, such as `MIT`. |
| `package` | The npm package name. |
| `releases` | The listed releases, newest first. |

Each release has these fields:

| Field | What it holds |
| --- | --- |
| `version` | The package's version, written `x.y.z`. |
| `integrity` | The `dist.integrity` that npm gives the version. |
| `minClientVersion` | The oldest Client version the release runs on, the same as `etherpk.minClientVersion` in `package.json`. |
| `source` | The git tag the release was built from. |
| `reviewed` | A date written `YYYY-MM-DD`. Set it to the day you open the pull request, and the reviewer changes it to the day of the review. |

No other entry may use the same `id` or `package`, and an entry may have no other fields.

For a new release, add one object at the top of `releases`, and leave the older releases as they are.

Then follow these steps:

1. Run `npm run build` to update `directory.json`, and commit it with your entry. CI fails when `directory.json` isn't up to date.
2. Run `npm run validate` to check the entry, and `npm run verify -- <id> <version>` to run the release check yourself.
3. Open the pull request and fill in its checklist.

## Review

A reviewer starts once CI's release check has passed. For an update, the reviewer reads the changes in your repository between the tag of the last listed release and the new tag. For a first listing, the reviewer reads the whole source. [REVIEWING.md](REVIEWING.md) is the checklist they follow. It covers these things, among others:

- Network requests, and where they go.
- `eval`, `new Function` and code loaded at run time.
- Document text kept outside the Client, and telemetry.
- Source that is minified or obfuscated.
- New dependencies, which are read too.

Anything the extension's description doesn't explain gets a question. There is no fixed time for a review. A small update is quicker to read than a first listing, because only the changes are read.

## Taking a release down

To take a release down, open a pull request that removes it from `releases`, or delete the file to remove the extension. You can also open an issue that names the release. Once the change is merged, Clients stop serving the release within about ten minutes.

If the reason is a security problem, don't describe it in a public issue or pull request. Report it on this repository's Security tab with **Report a vulnerability**, and ask for the release to be taken down.
