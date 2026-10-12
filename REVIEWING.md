# Reviewing a release

This is the checklist for a pull request that adds or changes a release. A pull request that only removes a release needs only the last section.

An extension runs with no sandbox in the Client's page, and it can read every document that is open on the device. Nothing else checks what it does, so read the source itself, not only the description.

## Before reading

- [ ] The **check** and **verify releases** jobs passed. The release check shows that the package on npm was built from the tagged source, so you read source and never the built bundle. Don't review a release whose release check failed.
- [ ] The pull request adds or changes one release, and `directory.json`.
- [ ] The entry's `repository` is the extension's real source repository, and the release's `source` is a tag in it.
- [ ] The `displayName`, `publisher` and `description` don't suggest that EtherPK or App Software made or endorse the extension. The check refuses those two names, but not other ways of saying it.

## Getting the changes

```sh
git clone https://github.com/example/etherpk-extension-garden
cd etherpk-extension-garden
git diff v1.1.0..v1.2.0
```

- [ ] For an update, read `git diff <previous tag>..<new tag>`. The previous tag is the `source` of the newest release already listed.
- [ ] For a first listing, read the whole source at the tag.
- [ ] Read the build scripts, the build configuration and the `package.json` changes too. CI runs the build, so a build step can change what CI reports.

## Reading for these

- [ ] Network requests: every `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, and image or link address built in code. Note where each one goes and what it sends.
- [ ] `eval`, `new Function`, and `setTimeout` or `setInterval` called with a string.
- [ ] Dynamic script loading: `import()` of anything but the extension's own files, script elements, and Workers made from a URL or a string.
- [ ] Use of the Client's frames (`embeds.frame`): which addresses the extension shows, and what part of a document goes into the address.
- [ ] Only Stable parts of the Extension API: compare what the extension uses from `context` and its manifest with `etc/etherpk-extension-api.public.api.md` in the EtherPK Client repository, at the version its `minClientVersion` names. A member marked `@beta` is Proposed and not allowed. The Client refuses a call to a Proposed member from an installed extension, so a release that makes one is broken as well as not allowed.
- [ ] A picture the extension returns for publishing (`toPicture`): read how it's made. An SVG picture is cleaned before it's published, but read it anyway.
- [ ] Settings of `type: "secret"`: where each value goes. Every extension running on a device can read every extension's settings, so a key is only as safe as the code of every extension installed beside it.
- [ ] `"isolation": "page"` in the manifest: the pull request says which library can't run in a shadow root, and the extension's stylesheets style only elements under its own classes.
- [ ] Storage of document text outside the Client: in `localStorage`, IndexedDB or cookies, or sent to any server.
- [ ] Telemetry, analytics or error reporting of any kind.
- [ ] Source that is obfuscated or minified. Source must be readable. Built files aren't reviewed, because the release check proves they come from the source.
- [ ] New dependencies. Read the lockfile diff. For each new or upgraded package, check that it's the package it claims to be, who publishes it, and what it does at run time. Ask about any dependency that comes from a git repository or a URL instead of the npm registry.
- [ ] Anything the extension's description doesn't explain. Ask the Publisher about it before merging.

## Recording the review

- [ ] Set the release's `reviewed` to today's date, and commit that to the pull request.
- [ ] Merge. The release appears in Clients within about ten minutes.

## Delisting a release

- [ ] Remove the release from `releases` in `extensions/<id>.json`. To delist the whole extension, delete the file.
- [ ] Run `npm run build` and commit `directory.json` with the change.
- [ ] Merge. The release check doesn't run for a removed release, so nothing waits on it. Clients stop serving the release within about ten minutes.
- [ ] If the release harms people who installed it, delist it first and contact the Publisher after.
