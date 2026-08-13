# Releasing MFDoctor

This is the maintainer flow for `@tonoizer/mfdoctor`. Public releases use plain
semver tags such as `1.0.0-rc.0`, never a `v` prefix.

## Prepare a version

1. Add a changeset for every public package change and merge it to `main`.
2. Let the `Prepare release` workflow create or update the
   `changeset-release/main` pull request.
3. Review the version and generated changelog in that dedicated PR.
4. Run the full release gate:

   ```bash
   vp install
   vp exec playwright install chromium
   vp run check
   vp run release:dry-run
   ```

5. Merge the version PR only after explicit release approval. The
   `Create GitHub release` workflow then creates the plain-semver tag and GitHub
   release. It explicitly dispatches the tag-gated release-file and npm staging
   workflows because GitHub does not recursively emit workflow events created
   with `GITHUB_TOKEN`. It does not run for other branches.

## Publish a release

Publishing a GitHub release runs `publish-on-release.yml`. It verifies that the
checkout is an immutable plain-semver tag matching `package.json`, runs release
gates on Node 22, 24, and 26, and submits the package with `npm stage publish`.
Prereleases use npm tag `next`; stable versions use `latest`. A maintainer must
approve the staged package with npm account 2FA.

The job uses GitHub OIDC and npm provenance, not `NPM_TOKEN`. The repository
`npm` environment requires approval and accepts deployments only from `main` or
a tag. Release-tag update and deletion are protected by a repository ruleset.

## Validate a release

Treat `1.0.0-rc.0` as a public prerelease on npm tag `next`, not as the stable
launch. Before promoting it, verify all of the following against the published
package rather than the repository workspace:

- a clean project can install the selected `next` or `latest` tag on Node 22, 24, and 26;
- `mfdoctor --help`, `mfdoctor check`, and one workspace command run from the
  installed package;
- the Vite, Nuxt, Rspack, Rsbuild, Webpack, and Modern.js documented imports
  resolve from the packed exports;
- npm shows the expected provenance and the package contains only reviewed
  release files;
- the GitHub prerelease has the matching immutable tag, changelog, tarball, and
  checksums;
- the canonical docs, CLI reference, integrations guide, and representative
  rule page are live;
- no release-blocking regressions are reported from real external projects.

For a prerelease, use Changesets prerelease mode and npm tag `next`. Stable
releases use npm tag `latest`. Never reuse or move a public release tag.

## Release artifacts and failures

`Generate release files` attaches the npm tarball, `SHA256SUMS`, and a release
manifest to the GitHub release. It does not publish to npm.

Never reuse or overwrite a published version. Reject a bad staged package
before approval. If an approved version is bad, fix the cause and release a new
version. Deprecate a bad npm version with a reason; do not unpublish unless npm
policy and an incident owner require it.
