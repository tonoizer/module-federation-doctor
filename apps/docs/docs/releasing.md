# Releasing

The public package is `@tonoizer/mfdoctor`. Releases use plain semver
tags such as `1.2.3` (never `v1.2.3`).

## Prepare a version

1. Run `pnpm changeset` with every public change.
2. Merge changes to `main`.
3. The `Prepare release` workflow creates or updates the
   `changeset-release/main` pull request. It applies Changesets and generates
   the changelog, but it cannot publish.
4. Review the version and notes in that dedicated PR and wait for the full gate:

   ```bash
   npm install --global pnpm@11.17.0
   pnpm install --frozen-lockfile
   pnpm exec playwright install chromium
   pnpm check
   pnpm release:dry-run
   ```

   `pnpm check` runs formatting, linting, and Changesets first, then builds
   before typechecking and runs unit and integration tests, demos, end-to-end
   tests, docs, and package checks. The package checks include the schema
   contract and packed package consumer checks. The examples and end-to-end
   tests cover consumers resolving the built package. Release CI runs this
   gate on Node 22 and 24, then runs `pnpm release:dry-run` on Node 24 before
   publishing. The dry run repeats the pack gate and verifies npm packaging
   without publishing.

5. Merge the version PR only when the release is approved. The
   `Create GitHub release` workflow creates the immutable plain-semver tag and
   GitHub release. It ignores every other PR branch.

The repository is already in Changesets `rc` prerelease mode. The checked-in
major changeset makes the first generated version PR `1.0.0-rc.0`; merging this
setup PR does not itself create a tag or release.

After a candidate passes the registry, documentation, and clean-consumer smoke
tests, exit prerelease mode in a normal reviewed PR:

```bash
pnpm changeset pre exit
```

After that PR merges, the same Changesets automation prepares the stable
`1.0.0` version PR.

When that release is published, `Generate release files` builds the package
from the release tag and attaches three files to the GitHub release:

- the npm package tarball
- `SHA256SUMS` for the tarball
- `release-manifest.json` with the package, version, tag, commit, and checksum

This workflow only creates GitHub release assets. It does not publish to npm.
It can be rerun from Actions with an existing release tag; uploads replace
same-named assets so retries are safe.

## Compatibility matrix and release blockers

Before claiming a bundler or runtime cell in release notes, confirm the
[compatibility matrix](./compatibility.md) status and the `compatibility`
workflow. Supported Vite / Rspack / Rsbuild / Webpack cells failing on Node 22
or 24, or missing terminal / JSON / SARIF artifacts on the CI path, **block**
release.

## Stage and approve

Publishing the GitHub release runs `publish-on-release.yml`. The workflow
validates that the checkout is an immutable plain-semver tag matching
`package.json`, runs the release gates on Node 22 and 24, and submits the
package with `npm stage publish` when the package already exists.

Prerelease versions are staged for npm tag `next`; stable versions are staged
for `latest`. A maintainer must approve the staged package with npm account 2FA
before it becomes installable. Never reuse a published version. `pkg-pr-new`
previews are temporary and do not reserve a permanent npm version.

## Trusted publishing

The package must exist before npm allows trusted-publisher configuration or
staged publishing. For the first package only, the release workflow verifies
the tag and reports a bootstrap notice instead of attempting OIDC publishing.
After explicit approval, check out the exact clean, merged release tag and run
one authenticated, 2FA-protected `npm publish --access public --tag next`.
Never bootstrap from an uncommitted worktree. Then configure a trusted
publisher for:

- GitHub repository: `tonoizer/module-federation-doctor`
- Workflow: `publish-on-release.yml`
- Package: `@tonoizer/mfdoctor`

Allow `npm stage publish` only. The release job uses GitHub OIDC and automatic
npm provenance. It does not use `NPM_TOKEN`. The repository `npm` environment
requires approval and accepts deployments only from `main` or a tag. Release-tag
update and deletion are blocked by a repository ruleset.
After trust is configured and verified, set package access to require 2FA and
disallow token publishing. All later releases are staged by CI; Changesets
prepares versions and changelogs but does not authenticate or publish them.

## Failed publish and rollback

Do not delete or overwrite a published version. Reject a bad staged package
before approval. If an approved version is bad, fix the cause, create a new
patch changeset, and release a new version. If a GitHub release failed before
npm staging, fix the workflow and rerun it only after checking
`npm view @tonoizer/mfdoctor@<version>`. Deprecate a bad npm version with
a reason; do not unpublish unless npm policy and an incident owner require it.
