# Modern.js compatibility smoke

**Warning — partial, not supported.** This example is a **Rspack stub**, not a
full `@modern-js/app-tools` app. Do not treat a green `modern-smoke` / this tree
as first-class Modern.js App Tools support. Matrix status stays **partial**
(App Tools CI lockfile-blocked; upstream core-demo re-soak is #130).

Exercises `@tonoizer/mfdoctor/modern` the way Modern.js registers plugins:
`modifyBundlerChain` attaches the same post-emit MFDoctor hook used by direct
Rspack. The smoke build uses `@rspack/core` + `@module-federation/enhanced/rspack`
under the hood (what Modern.js does internally) so CI stays inside this
repository's lockfile policy.

A real `@modern-js/app-tools@3.8.2` + `@module-federation/modern-js-v3@2.8.2`
CSR production emit (writes `remoteEntry.js`, `mf-manifest.json`,
`mf-stats.json`) works **outside** this lockfile. It cannot be added here:
`pnpm-workspace.yaml` `trustPolicy: no-downgrade` rejects current App Tools
because `2.63.x` published npm provenance and later releases dropped it. The
last provenance-attested stable is `2.63.3` (2024-12-18), which is too old to
pair with Module Federation `2.8.2`. Weakening `trustPolicyExclude` for the
whole `@modern-js/*@3.8.2` family is out of scope for this cell.

The upstream core-demo re-soak remains
[#130](https://github.com/tonoizer/module-federation-doctor/issues/130).

**Not** a replacement for `@tonoizer/mfdoctor/rspack` — bare Rspack apps
keep using that entry. See `modern.config.mjs` for the real Modern.js config
shape.
