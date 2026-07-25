# Releasing

Releases use plain semver tags such as `1.2.3`, npm trusted publishing through
GitHub OIDC, provenance, and no long-lived npm token.

1. Run `pnpm changeset`.
2. Merge the change.
3. Run `pnpm version` and review the changelog.
4. Run `pnpm check` and `pnpm release:dry-run`.
5. Push the version commit.
6. Create the matching GitHub release without a leading `v`.

Normal releases publish with npm tag `latest`; prereleases use `next`. Configure
the npm trusted publisher for repository `tonoizer/module-federation-doctor`,
workflow `publish-on-release.yml`, and package `@module-federation/doctor`.

Never overwrite or delete a published version as routine rollback. Fix the
problem, make a patch changeset, and publish a new version. If the npm scope is
not available, tarball validation and preview packages still work, while the
permanent publish stops at npm access control.
