# ADR: Hybrid plugin-primary + CLI complementary

## Status

Accepted for issue #137. Documents the settled delivery model; does not reopen
[#32](https://github.com/tonoizer/module-federation-doctor/issues/32),
[#33](https://github.com/tonoizer/module-federation-doctor/issues/33),
[#34](https://github.com/tonoizer/module-federation-doctor/issues/34), or
[#13](https://github.com/tonoizer/module-federation-doctor/issues/13).

## Context

Doctor needs one citable answer for how analysis is delivered: bundler adapters
vs CLI vs anything injected into the browser. Closed product issues already
encode the choice, but contributors and agents still rediscover the debate.
This ADR locks the model so docs, adapters, and roadmap work stay aligned.

## Decision

**Plugin primary / CLI complementary / not CLI-only / not in-browser agent.**

1. **Primary:** Vite / Rspack / Rsbuild / Webpack (and future) **post-emit /
   after-build** Doctor adapters analyze the current app with real emit facts
   (manifests, stats, public MF options). Adapters are post-emit only — no
   `transform` / `load` / banner hooks that inject Doctor into assets.
2. **Complementary CLI:** `mfdoctor check`, `workspace` / `federation`,
   `runtime`, `probe`, `baseline`, and `rules` cover offline, CI, cross-project,
   and cases where plugin hooks are unavailable. Without emit evidence the CLI
   must report honest partial analysis — not invent emit facts.
3. **Not CLI-only:** Do not redesign Doctor as a source-only CLI that pretends
   emit evidence exists.
4. **Not runtime-injected:** No Doctor agent in the browser bundle. Observability
   remains a **user-exported offline import** (`mfdoctor runtime` / related
   paths from [#17](https://github.com/tonoizer/module-federation-doctor/issues/17)
   / [#105](https://github.com/tonoizer/module-federation-doctor/issues/105)).
5. **Package install:** `@module-federation/doctor` is a **`devDependency`** —
   build/CI-only, never a production client dependency.

## Consequences

- Adapter work targets post-emit lifecycle hooks and public emit/config inputs.
- CLI remains valuable for gates and offline use; weaker evidence stays
  `doctor/partial-analysis` (or equivalent honesty), not silent overclaim.
- Install and packaging docs keep Doctor off the client bundle path.
- HTML analysis UI and in-browser Doctor agents stay out of scope (closed
  decisions above).
- CSS isolation product surface and Next.js adapter policy are non-goals of this
  ADR.

## References

- [#32](https://github.com/tonoizer/module-federation-doctor/issues/32) —
  build-time only / never in client bundle (`devDependency`)
- [#33](https://github.com/tonoizer/module-federation-doctor/issues/33) —
  in-browser Doctor runtime agent (not planned)
- [#34](https://github.com/tonoizer/module-federation-doctor/issues/34) —
  runtime-only MF without bundler plugin out of first-class scope
- [#13](https://github.com/tonoizer/module-federation-doctor/issues/13) —
  HTML analysis UI beyond portable reports (not planned)
- [#30](https://github.com/tonoizer/module-federation-doctor/issues/30) —
  v1.0 roadmap epic
- [#137](https://github.com/tonoizer/module-federation-doctor/issues/137) —
  this ADR
