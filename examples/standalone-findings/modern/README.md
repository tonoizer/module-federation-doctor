# Standalone Modern findings cell

Exercises `@tonoizer/mfdoctor/modern` the way Modern.js registers plugins:
`modifyBundlerChain` attaches the same post-emit MFDoctor hook used by direct
Rspack. The build uses `@rspack/core` + `@module-federation/enhanced/rspack`
under the hood (what Modern.js does internally) so CI stays light without
pulling `@modern-js/app-tools`.

This is a **documented stub** of the Modern adapter afterEmit path with
intentional findings and `failOn: "never"`. Matrix status stays **partial** —
not a first-class `@modern-js/app-tools` claim (that is #130 / BL-26). Green
adapter wiring smoke lives in [`../../compatibility/modern`](../../compatibility/modern).

**Not** a replacement for `@tonoizer/mfdoctor/rspack` — bare Rspack apps keep
using that entry (see `rspack/` in this folder).

```bash
vp run --filter @mfdoctor-standalone/modern build
```

Expect `.mf/doctor/report.json` with `shared/version-unsatisfied` and
`shared/singleton-risk`. The report stays incomplete (`partial-bundler`) because
`bundler` is recorded as `modern`.
