# Releasing

The public package is `@module-federation/doctor`. Releases use plain semver
tags such as `1.2.3` (never `v1.2.3`).

## Prepare a version

1. Run `pnpm changeset` with every public change.
2. Merge changes to `main`.
3. Run `pnpm version` to apply Changesets and generate the changelog.
4. Run the full local gate:

   ```bash
   pnpm install --frozen-lockfile
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

5. Push the version commit without a tag.
6. Create a GitHub release whose tag exactly matches `package.json`.

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

## Stable and prerelease

A normal GitHub release publishes with npm tag `latest`. A prerelease publishes
with npm tag `next`. Never reuse a published version. `pkg-pr-new` previews are
temporary and do not reserve a permanent npm version.

## Trusted publishing

In npm package settings, configure a trusted publisher for:

- GitHub repository: `tonoizer/module-federation-doctor`
- Workflow: `publish-on-release.yml`
- Package: `@module-federation/doctor`

The release job uses GitHub OIDC and npm provenance. It does not use
`NPM_TOKEN`. If the npm scope is not available, previews and dry runs still
work; permanent publish stops with a clear npm access error.

## Failed publish and rollback

Do not delete or overwrite a published version. Fix the cause, create a new
patch changeset, and release a new version. If a GitHub release failed before
npm publish, fix the workflow and rerun it only after checking
`npm view @module-federation/doctor@<version>`. Deprecate a bad npm version with
a reason; do not unpublish unless npm policy and an incident owner require it.
