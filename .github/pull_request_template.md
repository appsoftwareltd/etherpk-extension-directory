<!-- One release per pull request. CONTRIBUTING.md explains each step. -->

## Release

- Extension id:
- Version:
- Source tag:
- What changed since the last listed release:

## Publisher

- [ ] I pushed the tag named in `source` to the public source repository.
- [ ] I packed the release with `npm pack` from a clean checkout of the tag, and published that tarball with `npm publish <tarball>`.
- [ ] `integrity` is what `npm view <package>@<version> dist.integrity` prints.
- [ ] The release's `minClientVersion` is the same as `etherpk.minClientVersion` in the published `package.json`.
- [ ] I ran `npm run build` and committed the updated `directory.json`.

## Reviewer

- [ ] The **check** and **verify releases** jobs passed.
- [ ] I read the changes since the last listed release, or the whole source for a first listing, with the checklist in REVIEWING.md.
- [ ] I set `reviewed` to the date of the review.

Notes from the review:
