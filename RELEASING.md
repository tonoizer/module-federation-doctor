# Releasing Module Federation Doctor

This is the maintainer flow for `@tonoizer/mfdoctor`. Public releases use plain
semver tags such as `1.0.0-rc.0`, never a `v` prefix.

## Prepare a version

1. Add a changeset for every public package change and merge it to `main`.
2. Let the `Prepare release` workflow create or update the
   `changeset-release/main` pull request.
3. Review the version and generated changelog in that dedicated PR.
4. Run the full release gate:

   ```bash
   npm install --global pnpm@11.17.0
   pnpm install --frozen-lockfile
   pnpm exec playwright install chromium
   pnpm check
   pnpm release:dry-run
   ```

5. Merge the version PR only after explicit release approval. The
   `Create GitHub release` workflow then creates the plain-semver tag and GitHub
   release. It does not run for other branches.

The repository is already in Changesets `rc` prerelease mode. Its checked-in
major changeset makes the first version PR `1.0.0-rc.0`. Merging the release
readiness setup PR does not create a tag, release, or npm version.

## First RC bootstrap

Because `@tonoizer/mfdoctor` does not exist on npm yet, the first release
requires one authenticated bootstrap publish:

1. Confirm account-level publishing 2FA is enabled.
2. Review and merge the generated `1.0.0-rc.0` version PR.
3. Wait for the GitHub release workflow to create and verify the immutable tag.
4. From a clean checkout of that exact tag, verify the authenticated account
   and publish the prerelease:

   ```bash
   npm whoami
   npm publish --access public --tag next
   ```

5. Configure npm trusted publishing for:

   - repository: `tonoizer/module-federation-doctor`
   - workflow: `publish-on-release.yml`
   - package: `@tonoizer/mfdoctor`

Do not run the bootstrap publish from an uncommitted worktree or the release
readiness branch.

## Subsequent releases

Publishing a GitHub release runs `publish-on-release.yml`. It verifies that the
checkout is an immutable plain-semver tag matching `package.json`, runs release
gates on Node 22 and 24, and submits the package with `npm stage publish`.
Prereleases use npm tag `next`; stable versions use `latest`. A maintainer must
approve the staged package with npm account 2FA.

The job uses GitHub OIDC and npm provenance, not `NPM_TOKEN`. The repository
`npm` environment requires approval and accepts deployments only from `main` or
a tag. Release-tag update and deletion are protected by a repository ruleset.

After the RC is proven, exit prerelease mode in a reviewed change:

```bash
pnpm changeset pre exit
```

Changesets then prepares the stable `1.0.0` version PR.

## Release artifacts and failures

`Generate release files` attaches the npm tarball, `SHA256SUMS`, and a release
manifest to the GitHub release. It does not publish to npm.

Never reuse or overwrite a published version. Reject a bad staged package
before approval. If an approved version is bad, fix the cause and release a new
version. Deprecate a bad npm version with a reason; do not unpublish unless npm
policy and an incident owner require it.
