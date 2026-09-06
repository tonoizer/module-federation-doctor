# MFDoctor improvement backlog

Scored, mini-PR-sized follow-ups from an audit of `@tonoizer/mfdoctor`
(tonoizer/module-federation-doctor) against Module Federation surfaces
(Vite, Rspack/Enhanced, Rsbuild, Webpack, Modern.js, Nuxt).

**This document is analysis only.** It does not change product behavior.
Do not treat it as a license to add suppressions, probe the network, bump
versions, or claim green from `mfdoctor check` alone.

Canonical product docs stay under `apps/docs/docs/` (localized). This file
lives next to ADRs so it is **not** on the Rspress site and does not need a
German twin.

Verify skill: `.cursor/skills/verify-mfdoctor/` — **note gaps, do not
regenerate the map in this workstream.**

**Ownership:** Kevin handed the follow-up (maintain verify-mfdoctor plus
the 20–100 mini fix PRs in this list) to the **MF Doctor bot**, not
Developer. This document is the handoff packet. Do not start the fix
swarm from this analysis PR.

---

## Kurzfassung

MFDoctor ist **governance-ready für Vite / Rspack / Rsbuild / Webpack**:
112 Rules, echte Adapter-Emits, ehrliche Partial-Zellen für Rolldown,
Modern.js und Nuxt. Die größten Löcher sind nicht „fehlendes Dashboard“,
sondern (1) **Rule-Metadaten lügen über Bundler**, (2) **Vite-Quirks ohne
Enhanced-Geschwister**, (3) **Agent-Fixtures**: Showcase-README driftet,
halbe Rule-Familien ohne CLI-Leaf, Verify-Skill deckt `prompt` /
`baseline` / `runtime` nicht ab, (4) **Library-Overhead**: Identity /
Governance / Semantic-Graph / Capture sind groß und nicht CLI-verdrahtet.

Nicht anfassen: Evidence-v2-Default umschalten, HTML-UI, In-Browser-Agent,
Private-Field-Scraping, Runtime-only-MF, Next.js-Adapter, `--fix`.

---

## Executive summary

### Overall health

The product is in good shape for a 1.1.x governance tool. Built-ins are
migrated (`RULE_COMPATIBILITY_EXCEPTIONS` is empty by design). First-class
CI cells exist for Vite (including Vite 5 CJS), Rspack, Rsbuild, and
Webpack. Modern.js and Nuxt/Rolldown are **honestly partial**. Non-goals
(no HTML UI, no in-browser agent, no private MF fields, no runtime-only
host as first-class) are documented and should stay that way.

The doctor is weaker where Module Federation is **not** Vite:

| Surface                                                         | Doctor strength                           | Hole                                                                     |
| --------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| Shared singleton / versions / `import: false` / prefix share    | Strong                                    | cross-layer mismatch (BL-42 follow-up), bundler `externals` ∩ `shared`   |
| Remotes / exposes / manifest / dts outputDir                    | Strong                                    | `consumeTypes` / `remoteTypeUrls` / `extractRemoteTypes` unused as rules |
| Vite dialect (alias, manualChunks, hashed filename, HMR, Nitro) | Strong on Vite                            | Same failure modes on Webpack/Rspack/Rsbuild mostly unchecked            |
| Bridge React/Vue, SSR node plugin, runtime plugins              | Rules + unit/fixtures                     | Almost no showcase / emit leaves for agents                              |
| `output.publicPath` / duplicate plugin count                    | Webpack/Rspack adapters                   | Vite/Rsbuild documented blind spots                                      |
| Cross-app federation                                            | Workspace gate + showcase `.project.json` | `shareStrategy` defaulting can fake alignment                            |
| Identity / semantic graph / waivers / capture                   | Large public library                      | Not on the CLI/engine product path                                       |

### Biggest coverage holes vs Vite vs Rspack

**Vite** already has the richest dialect rules (`vite/*`,
`config/copied-webpack-options-on-vite`, prefix/subpath version). Agents
still cannot _drive_ most of them: there is no `examples/showcase/vite/`
tree. Rolldown/Vite Plus share the Vite adapter but have **no** local CI
smoke cell.

**Rspack / Enhanced / Rsbuild / Webpack** miss sibling checks that Vite
already has:

- `resolve.alias` ∩ `shared` (only `vite/alias-share-bypass`)
- hashed `filename` / contenthash remoteEntry (only `vite/hashed-remote-filename`)
- `optimization.splitChunks` / cacheGroups fighting MF runtime chunks
- Vite-only keys pasted onto Enhanced (`virtualModuleDir`, `remoteHmr`, …)
- Rspack `experiments.asyncStartup` without a **bundler version** gate
  (upstream: Rspack > 1.7.4)
- `shared` ∩ bundler `externals` (MF skill `SHARED-EXTERNALS-CONFLICT`;
  doctor has transformImport but not externals)

Rsbuild-specific `config/rsbuild-mf-api-generation` and
`config/transform-import-share-conflict` exist; transformImport still
depends on adapter-supplied library facts and is easy to skip silently.

### Top 10 to do first

| Rank | ID    | Score | Title                                                                                                |
| ---- | ----- | ----- | ---------------------------------------------------------------------------------------------------- |
| 1    | BL-01 | 96    | Wire `supportedBundlers` from inventory into `createRule` and `mfdoctor rules`                       |
| 2    | BL-02 | 94    | Sync `examples/showcase/README.md` with `scripts/demo-showcase.mjs`                                  |
| 3    | BL-03 | 92    | Add verify-skill feature files for `prompt`, `federation` (glob), `baseline`, `runtime`              |
| 4    | BL-04 | 90    | Add Nuxt as a `partial` cell in `fixtures/compatibility-matrix.json`                                 |
| 5    | BL-05 | 88    | Record Vite/Rsbuild publicPath facts (or honest skip) for `artifact/public-path-non-string-manifest` |
| 6    | BL-06 | 87    | Webpack/Rspack/Rsbuild `resolve.alias` ∩ `shared` sibling of `vite/alias-share-bypass`               |
| 7    | BL-07 | 86    | Rule: package in both `shared` and bundler `externals`                                               |
| 8    | BL-08 | 85    | Do not default omitted `shareStrategy` to `version-first` when comparing hosts                       |
| 9    | BL-09 | 84    | Rspack version gate for `experiments.asyncStartup`                                                   |
| 10   | BL-10 | 83    | Inventory flag: showcase-covered vs unit-only (gate `inventory:check`)                               |

### What NOT to touch

Do not open PRs that:

- Promote evidence v2 from default `legacy` (`EVIDENCE_ROLLOUT_V2.md`, #87)
  or merge the dual rule/federation bridges as a rewrite.
- Productize `semantic-graph` / identity-governance / waivers as default
  CLI/report output (ADR 0086: library-only until a later gate).
- Invent HTML UI / `--ui`, in-browser doctor, MCP, `check --watch`, or a
  general `--fix`.
- Scrape private Module Federation plugin fields (CONTRIBUTING adapter
  contract; #18).
- Add a Next.js (`nextjs-mf`) adapter — upstream is Pages-Router-only and
  unmaintained; document as unsupported instead (BL-22).
- Treat runtime-only `@module-federation/runtime` hosts as first-class.
- Add baselines, severity overrides, or rule `off` to “clear” findings.
- Bump versions / add changesets for doc-only or inventory-tag work unless
  a later fix PR actually ships user-facing behavior.
- Regenerate `.cursor/skills/verify-mfdoctor/` wholesale — add **new**
  feature files only (BL-03).

### Scoring

`score` (1–100, higher = do sooner) combines:

- **severity** (P0 correctness / agent-misleading > P1 user-visible MF
  failure > P2 hygiene > P3 nice-to-have)
- **impact** (how often agents or bundler users hit it)
- **safety** (small, independently mergeable, tests already nearby)

Effort: **S** one file / mechanical, **M** rule + fixture + docs, **L**
new example app or adapter evidence.

Low-confidence items are marked in `why`.

Audit date: 2026-09-06. Checkout: `main` @ `80a08b6` (and this branch).
Rule count: 112 built-ins in `src/rule-inventory.ts`. No knip/ts-prune in
`package.json`. Dist was not required for this inventory.

---

## Verify-skill map (do not regenerate)

`.cursor/skills/verify-mfdoctor/features/` currently maps:

| Mapped                                             | Not mapped (intentional today)                                       |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| capabilities, check, workspace, plugin-emit, rules | `prompt`, `baseline`, `runtime`                                      |
|                                                    | `federation` without `--workspace` (noted as same gate as workspace) |
|                                                    | network `probe` / `compare`                                          |
|                                                    | HTML UI, in-browser agent, `docs:dev`                                |

Gaps to **add files for**, not rewrite: BL-03, BL-45. Plugin-emit already
points at `examples/standalone-findings/{vite,webpack,rspack,rsbuild}` —
that path is correct.

---

## Ranked compact index

| Rank | ID    | Score | Sev | Effort | Cat       | Bundlers                         | Title                                                              |
| ---- | ----- | ----- | --- | ------ | --------- | -------------------------------- | ------------------------------------------------------------------ |
| 1    | BL-01 | 96    | P1  | S      | coverage  | all                              | `supportedBundlers` lies (createRule + CLI catalog)                |
| 2    | BL-02 | 94    | P1  | S      | docs      | all                              | Showcase README missing live demo cases                            |
| 3    | BL-03 | 92    | P1  | M      | tests     | all                              | Verify-skill: prompt / baseline / runtime / federation glob        |
| 4    | BL-04 | 90    | P1  | S      | docs      | all                              | Nuxt missing from machine-readable bundler matrix                  |
| 5    | BL-05 | 88    | P1  | M      | coverage  | vite, rsbuild                    | publicPath facts for non-string manifest rule                      |
| 6    | BL-06 | 87    | P1  | M      | coverage  | rspack, rsbuild, webpack         | alias ∩ shared outside Vite                                        |
| 7    | BL-07 | 86    | P1  | M      | coverage  | rspack, rsbuild, webpack, modern | shared ∩ bundler externals                                         |
| 8    | BL-08 | 85    | P1  | S      | coverage  | all                              | Omitted shareStrategy default fakes alignment                      |
| 9    | BL-09 | 84    | P1  | M      | coverage  | rspack, rsbuild                  | asyncStartup without Rspack version                                |
| 10   | BL-10 | 83    | P1  | M      | tests     | all                              | Inventory: showcase vs unit-only                                   |
| 11   | BL-11 | 82    | P1  | L      | tests     | all                              | Nuxt example app (partial cell, real emit)                         |
| 12   | BL-12 | 81    | P1  | M      | tests     | vite                             | Showcase leaves for `vite/*` rules                                 |
| 13   | BL-13 | 81    | P1  | M      | coverage  | webpack, rspack                  | Hashed remoteEntry filename outside Vite                           |
| 14   | BL-14 | 80    | P1  | M      | coverage  | all                              | Normalize + check `shared.packagePath`                             |
| 15   | BL-15 | 80    | P1  | M      | tests     | all                              | Showcase leaves for `bridge/*`                                     |
| 16   | BL-16 | 79    | P1  | S      | coverage  | all                              | Rule (or skip) for `extractRemoteTypes`                            |
| 17   | BL-17 | 79    | P1  | M      | tests     | all                              | Showcase leaves for artifact / ssr / runtime-plugins               |
| 18   | BL-18 | 78    | P2  | S      | dead-code | all                              | Delete unused adapter `doctor` aliases                             |
| 19   | BL-19 | 78    | P1  | M      | coverage  | all                              | `consumeTypes` / `remoteTypeUrls` vs `.js` remotes                 |
| 20   | BL-20 | 77    | P2  | M      | coverage  | rspack, webpack, rsbuild         | Flag Vite-only keys on Enhanced config                             |
| 21   | BL-21 | 77    | P2  | L      | tests     | modern                           | Standalone Modern findings cell                                    |
| 22   | BL-22 | 76    | P2  | M      | coverage  | rspack, webpack, rsbuild         | splitChunks / cacheGroups vs MF runtime                            |
| 23   | BL-23 | 76    | P2  | S      | overeng   | all                              | Stop exporting unused `capability-packs` from `.`                  |
| 24   | BL-24 | 75    | P2  | M      | coverage  | vite, rsbuild                    | Duplicate MF plugin registration facts                             |
| 25   | BL-25 | 74    | P2  | M      | dx        | all                              | Add knip (or ts-prune) to CI                                       |
| 26   | BL-26 | 74    | P2  | L      | coverage  | modern                           | Real `@modern-js/app-tools` CI evidence                            |
| 27   | BL-27 | 73    | P2  | M      | overeng   | all                              | Slim public identity factories on `.`                              |
| 28   | BL-28 | 73    | P2  | L      | coverage  | vite                             | Rolldown / Vite Plus smoke build cell                              |
| 29   | BL-29 | 72    | P2  | M      | tests     | all                              | Adapter integration tests that actually emit                       |
| 30   | BL-30 | 72    | P2  | M      | coverage  | all                              | Remote `type: promise` / `script` contracts                        |
| 31   | BL-31 | 71    | P2  | S      | docs      | all                              | Agent-facing “evidence v2 is not default” banner                   |
| 32   | BL-32 | 71    | P2  | M      | coverage  | vite, rspack                     | Browser vs SSR remoteEntry pairing                                 |
| 33   | BL-33 | 70    | P2  | M      | coverage  | webpack, rspack                  | `don'tExpose` / expose filter surface                              |
| 34   | BL-34 | 70    | P2  | M      | coverage  | rspack                           | Legacy `@module-federation/rspack` vs Enhanced                     |
| 35   | BL-35 | 70    | P3  | S      | dead-code | webpack                          | Drop webpack `moduleFederationDoctorPlugin` alias                  |
| 36   | BL-36 | 69    | P2  | S      | docs      | all                              | Name Next.js as unsupported in limitations                         |
| 37   | BL-37 | 69    | P3  | S      | dead-code | all                              | Drop Nuxt `nuxtDoctor` / `federationDoctorNuxt` aliases            |
| 38   | BL-38 | 68    | P2  | S      | docs      | all                              | Capabilities matrix: Nuxt column                                   |
| 39   | BL-39 | 68    | P2  | M      | overeng   | all                              | Un-export lineage/waivers from public `.` until CLI uses them      |
| 40   | BL-40 | 68    | P2  | M      | tests     | rspack, webpack                  | Prefix-share / subpath tests on Enhanced                           |
| 41   | BL-41 | 67    | P2  | S      | tests     | all                              | `mfdoctor rules` proof of per-rule bundlers                        |
| 42   | BL-42 | 67    | P2  | M      | coverage  | webpack, rspack                  | Shared `layer` (low confidence)                                    |
| 43   | BL-43 | 66    | P3  | M      | coverage  | all                              | `dts.generateTypes.compilerInstance` / tsgo advisory               |
| 44   | BL-44 | 66    | P2  | S      | docs      | modern                           | Modern smoke README: not full app-tools                            |
| 45   | BL-45 | 65    | P2  | M      | tests     | modern                           | transformImport facts from Modern adapter                          |
| 46   | BL-46 | 65    | P3  | S      | dead-code | all                              | Remove or freeze `RULE_COMPATIBILITY_EXCEPTIONS` noise             |
| 47   | BL-47 | 64    | P2  | S      | coverage  | webpack, rspack                  | `output.uniqueName` vs MF `name`                                   |
| 48   | BL-48 | 63    | P2  | M      | coverage  | rsbuild, modern                  | SSR host-init analogues of `vite/host-init-inject-ssr`             |
| 49   | BL-49 | 62    | P2  | S      | overeng   | all                              | Un-export `projectV1Suppression` until runtime uses it             |
| 50   | BL-50 | 61    | P2  | M      | coverage  | all                              | Stats expected (Enhanced) vs unexpected (Vite)                     |
| 51   | BL-51 | 61    | P2  | L      | overeng   | all                              | Share projection helpers; do not merge runner yet                  |
| 52   | BL-52 | 60    | P3  | S      | docs      | all                              | Mark semantic-graph / identity APIs experimental on the `.` export |
| 53   | BL-53 | 59    | P3  | M      | coverage  | vite                             | Rules or honest skips for `ignoreOrigin` / `virtualModuleDir`      |
| 54   | BL-54 | 58    | P2  | L      | overeng   | all                              | Split `src/capture.ts` (~3.7k LOC) along used vs unused transports |
| 55   | BL-55 | 55    | P3  | S      | dead-code | all                              | Internalize `MIGRATED_GROUP*` exports                              |
| 56   | BL-56 | 54    | P3  | S      | docs      | all                              | `buildUiPayload` is not an HTML UI (cross-link only)               |
| 57   | BL-57 | 52    | P3  | L      | coverage  | all                              | `dataPrefetch` / prefetch remotes (low confidence)                 |
| 58   | BL-58 | 48    | P3  | S      | dead-code | all                              | Un-export `DEFAULT_ANALYSIS_CACHE_OPTIONS`                         |

---

## Items (score descending)

### BL-01 — Wire `supportedBundlers` from inventory

|                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **bundlers**           | all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **severity**           | P1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **effort**             | S                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **score**              | 96                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **why**                | Inventory correctly marks Vite-only rules with `VITE`, but `createRule` in `src/rules.ts` always sets `supportedBundlers` to every bundler including `unknown`. `src/engine.ts` gates on that field; `src/cli.ts` `toRuleMeta` hardcodes the same all-bundler list for `mfdoctor rules`. Agents and `mfdoctor rules` therefore advertise `vite/alias-share-bypass` and `shared/subpath-version-unresolved` as universal Enhanced behavior. Imperative `if (bundler.name !== "vite") return` is the real gate — meta is a lie. |
| **evidence**           | `src/rules.ts` `createRule` (~69–85); `src/engine.ts` ~101; `src/cli.ts` `toRuleMeta` ~415–427; `src/rule-inventory.ts` `VITE` / `RSBUILD` / `ALL`                                                                                                                                                                                                                                                                                                                                                                            |
| **suggested PR title** | fix: drive supportedBundlers from rule inventory                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **acceptance**         | Vite-only inventory plans report `supportedBundlers: ["vite"]` from `mfdoctor rules`. Engine still skips non-Vite projects. Unit test asserts catalog vs inventory adapters.                                                                                                                                                                                                                                                                                                                                                  |

### BL-02 — Sync showcase README with demo script

|                        |                                                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | docs                                                                                                                                                                                                                                                                   |
| **bundlers**           | all                                                                                                                                                                                                                                                                    |
| **severity**           | P1                                                                                                                                                                                                                                                                     |
| **effort**             | S                                                                                                                                                                                                                                                                      |
| **score**              | 94                                                                                                                                                                                                                                                                     |
| **why**                | `scripts/demo-showcase.mjs` (release gate) already runs `async-boundary-missing`, `rsbuild-mf-api-generation`, `deep-import-bypass`, `host-gaps`, `ghost-shares`. `examples/showcase/README.md` omits them. Agents following the README miss runnable one-rule leaves. |
| **evidence**           | `examples/showcase/README.md` vs `scripts/demo-showcase.mjs` cases array                                                                                                                                                                                               |
| **suggested PR title** | docs: list every showcase leaf that demo-showcase runs                                                                                                                                                                                                                 |
| **acceptance**         | README tables match demo-showcase cases 1:1. Optional: small script or unit test that fails on drift.                                                                                                                                                                  |

### BL-03 — Verify-skill recipes for prompt / baseline / runtime / federation glob

|                        |                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | tests                                                                                                                                                                                                                                                                                                                                                            |
| **bundlers**           | all                                                                                                                                                                                                                                                                                                                                                              |
| **severity**           | P1                                                                                                                                                                                                                                                                                                                                                               |
| **effort**             | M                                                                                                                                                                                                                                                                                                                                                                |
| **score**              | 92                                                                                                                                                                                                                                                                                                                                                               |
| **why**                | AGENTS.md and `apps/docs/docs/agent-loop.md` require `mfdoctor prompt --finding` after check. The verify skill explicitly leaves `prompt` / `baseline` / `runtime` unmapped and folds `federation` into workspace. Agents invent flags or skip the documented loop. Do **not** regenerate existing feature files; add new ones. Stay offline (no probe/compare). |
| **evidence**           | `.cursor/skills/verify-mfdoctor/features/README.md` “Explicitly not mapped”; `apps/docs/docs/cli.md`; `apps/docs/docs/agent-loop.md` step 3                                                                                                                                                                                                                      |
| **suggested PR title** | chore: map prompt, baseline, runtime, federation glob in verify-mfdoctor                                                                                                                                                                                                                                                                                         |
| **acceptance**         | Four new feature files with the four H2 sections. Evidence dirs under `.cursor/skills/verify-mfdoctor/evidence/`. Existing check/workspace/plugin-emit/rules files unchanged in intent.                                                                                                                                                                          |

### BL-04 — Nuxt in `compatibility-matrix.json` bundlers[]

|                        |                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | docs                                                                                                                                                                                                                                                                                                                                                                     |
| **bundlers**           | all                                                                                                                                                                                                                                                                                                                                                                      |
| **severity**           | P1                                                                                                                                                                                                                                                                                                                                                                       |
| **effort**             | S                                                                                                                                                                                                                                                                                                                                                                        |
| **score**              | 90                                                                                                                                                                                                                                                                                                                                                                       |
| **why**                | Human compatibility page lists Nuxt 3/4 as **partial**. Machine matrix `bundlers[]` only has vite/rolldown/rspack/rsbuild/webpack/modern. `src/capabilities.ts` builds CLI bundler matrix from that file. Agents reading `mfdoctor capabilities` miss Nuxt. `BundlerName` also omits `nuxt` (Nuxt rides the Vite adapter) — keep that, but the matrix cell should exist. |
| **evidence**           | `fixtures/compatibility-matrix.json`; `apps/docs/docs/compatibility.md` Nuxt row; `src/capabilities.ts`; `src/types.ts` `BundlerName`                                                                                                                                                                                                                                    |
| **suggested PR title** | fix: list Nuxt as partial in compatibility-matrix bundlers                                                                                                                                                                                                                                                                                                               |
| **acceptance**         | `bundlers[]` includes `{ id: "nuxt", status: "partial", adapter: "@tonoizer/mfdoctor/nuxt" }`. `mfdoctor capabilities` JSON reflects it. No false “supported”.                                                                                                                                                                                                           |

### BL-05 — Vite/Rsbuild publicPath facts

|                        |                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | coverage                                                                                                                                                                                                                                                                                                                             |
| **bundlers**           | vite, rsbuild                                                                                                                                                                                                                                                                                                                        |
| **severity**           | P1                                                                                                                                                                                                                                                                                                                                   |
| **effort**             | M                                                                                                                                                                                                                                                                                                                                    |
| **score**              | 88                                                                                                                                                                                                                                                                                                                                   |
| **why**                | `artifact/public-path-non-string-manifest` needs `outputPublicPathKind`. Webpack/Rspack set it via `classifyOutputPublicPath`. Limitations already admit Vite/Rsbuild are dark. Vite MF also has its own `publicPath` option (configuration-audit). Missing facts → silent skip, not partial-analysis, so agents think the rule ran. |
| **evidence**           | `src/plugin.ts` `classifyOutputPublicPath` ~171–186; `apps/docs/docs/limitations.md` Topology table; `apps/docs/docs/configuration-audit.md` Vite `publicPath`                                                                                                                                                                       |
| **suggested PR title** | feat: record Vite/Rsbuild publicPath kind for manifest rules                                                                                                                                                                                                                                                                         |
| **acceptance**         | Vite and Rsbuild adapters populate `outputPublicPathKind` from **public** config (`output.publicPath` / Vite MF `publicPath`) or emit `doctor/partial-analysis` when unobserved. Fixture covers non-string path. No private plugin scrape.                                                                                           |

### BL-06 — Alias ∩ shared on Webpack/Rspack/Rsbuild

|                        |                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | coverage                                                                                                                                                                                                                                               |
| **bundlers**           | rspack, rsbuild, webpack                                                                                                                                                                                                                               |
| **severity**           | P1                                                                                                                                                                                                                                                     |
| **effort**             | M                                                                                                                                                                                                                                                      |
| **score**              | 87                                                                                                                                                                                                                                                     |
| **why**                | Same singleton-bypass as Vite `resolve.alias`, but `vite/alias-share-bypass` returns immediately unless `bundler.name === "vite"`. Alias facts live only on `viteConfigFacts.resolveAliases`. Enhanced users hit this constantly (antd/react aliases). |
| **evidence**           | `src/rules.ts` ~1749; `src/plugin.ts` ~484, ~825 `viteConfigFacts`; `src/types.ts` `ViteBundlerConfigFacts.resolveAliases`; `src/rule-guidance.ts` `vite/alias-share-bypass`                                                                           |
| **suggested PR title** | feat: flag resolve.alias overlapping shared on webpack family                                                                                                                                                                                          |
| **acceptance**         | Public `resolve.alias` object entries overlapping `shared` keys warn on webpack/rspack/rsbuild. Function aliases stay unknown/partial. Vite rule unchanged. Showcase or unit fixture per bundler family.                                               |

### BL-07 — shared ∩ bundler externals

|                        |                                                                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                                 |
| **bundlers**           | rspack, rsbuild, webpack, modern                                                                                                                                                                                                                         |
| **severity**           | P1                                                                                                                                                                                                                                                       |
| **effort**             | M                                                                                                                                                                                                                                                        |
| **score**              | 86                                                                                                                                                                                                                                                       |
| **why**                | MF shared-deps skill (`SHARED-EXTERNALS-CONFLICT`): a library in both `shared` and `externals` is excluded from the bundle and still declared shared → runtime failure. Doctor covers `transformImport` and Vite SSR externals, not bundler `externals`. |
| **evidence**           | `.claude/skills/mf/reference/shared-deps.md`; `src/rules.ts` `vite/ssr-nitro-externals`, `config/transform-import-share-conflict`; no `externals` on `NormalizedMFConfig`                                                                                |
| **suggested PR title** | feat: detect shared packages also listed in externals                                                                                                                                                                                                    |
| **acceptance**         | Adapter or collect path records public `externals` (string/array/object keys only). Finding when a shared package name matches. Skip when externals unobserved (`partial-analysis` or silent skip documented).                                           |

### BL-08 — Omitted shareStrategy must not look aligned

|                        |                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | coverage                                                                                                                                                                                                                                                                                                     |
| **bundlers**           | all                                                                                                                                                                                                                                                                                                          |
| **severity**           | P1                                                                                                                                                                                                                                                                                                           |
| **effort**             | S                                                                                                                                                                                                                                                                                                            |
| **score**              | 85                                                                                                                                                                                                                                                                                                           |
| **why**                | `normalize.ts` and `federation-model.ts` default omitted `shareStrategy` to `"version-first"`. `federation/share-strategy-mismatch` then sees two “version-first” sides even when one plugin family would have behaved as loaded-first or the author never chose. False quiet on mixed Vite/Enhanced graphs. |
| **evidence**           | `src/normalize.ts` ~165; `src/federation-model.ts` ~114; `examples/showcase/federation/share-strategy-mismatch/`                                                                                                                                                                                             |
| **suggested PR title** | fix: treat omitted shareStrategy as unknown in federation compare                                                                                                                                                                                                                                            |
| **acceptance**         | Omitted vs omitted → no mismatch (or info). Omitted vs explicit other → warning or partial. Explicit version-first vs loaded-first still mismatches. Showcase updated.                                                                                                                                       |

### BL-09 — Rspack asyncStartup version gate

|                        |                                                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                                               |
| **bundlers**           | rspack, rsbuild                                                                                                                                                                                                                                                        |
| **severity**           | P1                                                                                                                                                                                                                                                                     |
| **effort**             | M                                                                                                                                                                                                                                                                      |
| **score**              | 84                                                                                                                                                                                                                                                                     |
| **why**                | MF config-check skill: Rspack must be > 1.7.4 for `experiments.asyncStartup`. Doctor uses the flag for `config/async-boundary-missing` and `reliability/async-startup-library-promise` but never checks the bundler version. Enabling on old Rspack is a silent break. |
| **evidence**           | `.claude/skills/mf/reference/config-check.md`; `src/rules.ts` asyncStartup uses ~1329–1382; `src/normalize.ts` ~167                                                                                                                                                    |
| **suggested PR title** | feat: warn asyncStartup on Rspack versions that cannot honor it                                                                                                                                                                                                        |
| **acceptance**         | When asyncStartup is true and installed `@rspack/core` / rsbuild rspack is ≤ 1.7.4 (or unknown → partial), emit a finding. No network. Pin the version cutoff to a cited upstream note.                                                                                |

### BL-10 — Inventory flag: showcase-covered vs unit-only

|                        |                                                                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | tests                                                                                                                                                                                                                                               |
| **bundlers**           | all                                                                                                                                                                                                                                                 |
| **severity**           | P1                                                                                                                                                                                                                                                  |
| **effort**             | M                                                                                                                                                                                                                                                   |
| **score**              | 83                                                                                                                                                                                                                                                  |
| **why**                | 112 rules; showcase + demo-showcase cover a minority. `inventory:check` / `evidence:drift` do not fail when a rule has no agent-runnable leaf. Agents guess from unit tests and over-claim green.                                                   |
| **evidence**           | `src/rule-inventory.ts`; `fixtures/rule-inventory/v1.json`; `scripts/generate-rule-inventory.mjs`; `examples/showcase/`; prefixes with no showcase: `artifact/*`, `bridge/*`, `vite/*`, `ssr/*`, `runtime-plugins/*`, `performance/*`, `security/*` |
| **suggested PR title** | feat: tag rules as showcase or unit-only in inventory                                                                                                                                                                                               |
| **acceptance**         | Each inventory entry has `demo: "showcase" \| "unit" \| "emit"`. `inventory:check` fails if a new rule has none. Existing rules can be tagged without adding fixtures in the same PR.                                                               |

### BL-11 — Nuxt example app (partial, real emit)

|                        |                                                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | tests                                                                                                                                                                                                                                                           |
| **bundlers**           | all                                                                                                                                                                                                                                                             |
| **severity**           | P1                                                                                                                                                                                                                                                              |
| **effort**             | L                                                                                                                                                                                                                                                               |
| **score**              | 82                                                                                                                                                                                                                                                              |
| **why**                | Adapter is unit-tested (`test/unit/nuxt.test.ts`) and upstream Nuxt example is baseline-blocked. Agents cannot copy a working `modules: ["@tonoizer/mfdoctor/nuxt", …]` app. Partial matrix honesty needs a **local** emit cell even if upstream stays blocked. |
| **evidence**           | `src/nuxt.ts`; `test/unit/nuxt.test.ts`; `fixtures/compatibility-matrix.json` `nuxt-vite-adapter` baseline-blocked; no `examples/**/nuxt*`                                                                                                                      |
| **suggested PR title** | test: add a partial Nuxt emit fixture for the doctor module                                                                                                                                                                                                     |
| **acceptance**         | A workspace example (or fixture) registers the Nuxt module, production-builds, writes `.mf/doctor/project.json`. Matrix `localCi` or unitContracts updated. Status stays **partial** until upstream unblocks.                                                   |

### BL-12 — Showcase leaves for `vite/*`

|                        |                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | tests                                                                                                                                                                                                                                            |
| **bundlers**           | vite                                                                                                                                                                                                                                             |
| **severity**           | P1                                                                                                                                                                                                                                               |
| **effort**             | M                                                                                                                                                                                                                                                |
| **score**              | 81                                                                                                                                                                                                                                               |
| **why**                | Vite dialect is the differentiator vs Enhanced, but agents have no `examples/showcase/vite/` one-rule dirs. CLI check on config-only fixtures can still demo hashed filename, remotes-prefer-module, copied-webpack-options, alias-share-bypass. |
| **evidence**           | `src/rule-inventory.ts` VITE plans ~690–817; `examples/showcase/` has config/shared/reliability/federation/runtime only                                                                                                                          |
| **suggested PR title** | test: add showcase fixtures for Vite dialect rules                                                                                                                                                                                               |
| **acceptance**         | At least hashed-remote-filename, remotes-prefer-module, copied-webpack-options-on-vite, alias-share-bypass leaves in demo-showcase + README. CLI-only is enough (not full Vite apps).                                                            |

### BL-13 — Hashed remoteEntry filename outside Vite

|                        |                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | coverage                                                                                                                                                                                   |
| **bundlers**           | webpack, rspack                                                                                                                                                                            |
| **severity**           | P1                                                                                                                                                                                         |
| **effort**             | M                                                                                                                                                                                          |
| **score**              | 81                                                                                                                                                                                         |
| **why**                | `vite/hashed-remote-filename` catches `[hash]` in Vite `filename`. Webpack/Rspack `[contenthash]` in `output.filename` / MF `filename` equally breaks stable remote URLs. No sibling rule. |
| **evidence**           | `src/rules.ts` ~1769 `vite/hashed-remote-filename`; inventory VITE-only; Webpack compatibility example uses stable names                                                                   |
| **suggested PR title** | feat: warn hashed remoteEntry filename on webpack/rspack                                                                                                                                   |
| **acceptance**         | Pattern check on public MF `filename` (and documented webpack output filename when observed). Vite rule can stay or share a helper. Showcase or unit fixture.                              |

### BL-14 — Normalize `shared.packagePath`

|                        |                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                    |
| **bundlers**           | all                                                                                                                                                                         |
| **severity**           | P1                                                                                                                                                                          |
| **effort**             | M                                                                                                                                                                           |
| **score**              | 80                                                                                                                                                                          |
| **why**                | Enhanced `shared[pkg].packagePath` redirects resolution. `NormalizedShared` has no field; `normalize.ts` drops it. Wrong path → version/singleton failures with no finding. |
| **evidence**           | `src/types.ts` `NormalizedShared` ~124–140; `src/normalize.ts` shared loop ~122–151; MF core `ModuleFederationPlugin` shared types (CONTRIBUTING research sources)          |
| **suggested PR title** | feat: preserve and validate shared.packagePath                                                                                                                              |
| **acceptance**         | packagePath round-trips in normalize. Missing path on disk → finding (or partial when unresolvable). Unknown bundlers skip honestly.                                        |

### BL-15 — Showcase leaves for `bridge/*`

|                        |                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | tests                                                                                                                                                                                                          |
| **bundlers**           | all                                                                                                                                                                                                            |
| **severity**           | P1                                                                                                                                                                                                             |
| **effort**             | M                                                                                                                                                                                                              |
| **score**              | 80                                                                                                                                                                                                             |
| **why**                | Bridge rules are implemented and unit-tested (`bridge-react`, `bridge-vue`) with golden `fixtures/mf-bridge-entry/`. Agents fixing `bridge/export-app-missing` cannot run `mfdoctor check` on a one-rule leaf. |
| **evidence**           | `src/bridge-detect.ts`; `test/unit/bridge-*.test.ts`; `fixtures/mf-bridge-entry/`; no `examples/showcase/bridge/`                                                                                              |
| **suggested PR title** | test: add CLI showcase fixtures for Bridge rules                                                                                                                                                               |
| **acceptance**         | At least two leaves (React export-app missing, Vue share missing or provider-shape) in demo-showcase. No need for a full Bridge app in this PR.                                                                |

### BL-16 — `extractRemoteTypes` collected, never ruled

|                        |                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                  |
| **bundlers**           | all                                                                                                                                                                                                       |
| **severity**           | P1                                                                                                                                                                                                        |
| **effort**             | S                                                                                                                                                                                                         |
| **score**              | 79                                                                                                                                                                                                        |
| **why**                | Configuration-audit tells humans to enable `dts.generateTypes.extractRemoteTypes` for nested producers. `federation-model.ts` records the boolean. No rule consumes it. Nested federation examples exist. |
| **evidence**           | `src/federation-model.ts` `FederationDtsFacts.extractRemoteTypes`; `apps/docs/docs/configuration-audit.md` “Nested producer DTS”; `examples/nested-federation/`                                           |
| **suggested PR title** | feat: advise extractRemoteTypes for nested remote producers                                                                                                                                               |
| **acceptance**         | Remote that both exposes and consumes remotes with dts on, and extractRemoteTypes false → warning. Host-only skips. Nested example stays green or documents waiver.                                       |

### BL-17 — Showcase leaves for artifact / ssr / runtime-plugins

|                        |                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | tests                                                                                                                                                                                                                       |
| **bundlers**           | all                                                                                                                                                                                                                         |
| **severity**           | P1                                                                                                                                                                                                                          |
| **effort**             | M                                                                                                                                                                                                                           |
| **score**              | 79                                                                                                                                                                                                                          |
| **why**                | Those families only live in fixtures (`mf-ssr-fragment`, `artifact-react-dom-server-in-web`, `fixtures/diagnostics/runtime-plugins/`) and unit tests. Agents cannot discover CORS/factory/SSR dual-env via `demo:showcase`. |
| **evidence**           | `examples/showcase/` prefixes; `fixtures/mf-ssr-fragment/`; `fixtures/artifact-react-dom-server-in-web/`; `fixtures/diagnostics/runtime-plugins/`                                                                           |
| **suggested PR title** | test: add showcase leaves for artifact, ssr, and runtime-plugin rules                                                                                                                                                       |
| **acceptance**         | Minimum one leaf per family in demo-showcase + README. CLI/config or committed project.json is enough.                                                                                                                      |

### BL-18 — Delete unused adapter `doctor` aliases

|                        |                                                                                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | dead-code                                                                                                                                                                                                                                                   |
| **bundlers**           | all                                                                                                                                                                                                                                                         |
| **severity**           | P2                                                                                                                                                                                                                                                          |
| **effort**             | S                                                                                                                                                                                                                                                           |
| **score**              | 78                                                                                                                                                                                                                                                          |
| **why**                | `export const doctor = …` on vite/rspack/rsbuild/webpack/modern is `@deprecated`. Examples and docs use idiomatic names. pack-check does not assert `.doctor`. Safe delete after a changelog note in a later release PR (this backlog PR does not ship it). |
| **evidence**           | `src/vite.ts` ~28–29; `src/rspack.ts` ~6–7; `src/rsbuild.ts` ~6–7; `src/webpack.ts` ~9–10; `src/modern.ts` ~117; grep: no example imports `doctor` from adapters                                                                                            |
| **suggested PR title** | chore: remove deprecated adapter doctor aliases                                                                                                                                                                                                             |
| **acceptance**         | Named exports gone. Docs/examples already clean. Pack-check still passes. Semver: breaking for anyone still importing `doctor` — confirm changelog; if 1.x compat required, keep one minor with a runtime warning instead of delete.                        |

### BL-19 — consumeTypes / remoteTypeUrls vs `.js` remotes

|                        |                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | coverage                                                                                                                                                                                                     |
| **bundlers**           | all                                                                                                                                                                                                          |
| **severity**           | P1                                                                                                                                                                                                           |
| **effort**             | M                                                                                                                                                                                                            |
| **score**              | 78                                                                                                                                                                                                           |
| **why**                | Configuration-audit: direct `.js` remotes need manifests or `remoteTypeUrls`. `federation-model.ts` already tracks `remoteTypeUrls`. Rules cover dts disabled / types missing / outputDir, not this pairing. |
| **evidence**           | `src/federation-model.ts` ~67–78; `apps/docs/docs/configuration-audit.md`; `src/rules.ts` dts rules ~1007, ~1857                                                                                             |
| **suggested PR title** | feat: flag .js remotes without consumeTypes remoteTypeUrls                                                                                                                                                   |
| **acceptance**         | Host with dts consume on, remotes pointing at `.js` (not manifest), and no remoteTypeUrls → warning. Manifest remotes skip.                                                                                  |

### BL-20 — Vite-only keys on Enhanced / Webpack

|                        |                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                              |
| **bundlers**           | rspack, webpack, rsbuild                                                                                                                                                                                                              |
| **severity**           | P2                                                                                                                                                                                                                                    |
| **effort**             | M                                                                                                                                                                                                                                     |
| **score**              | 77                                                                                                                                                                                                                                    |
| **why**                | Inverse of `config/copied-webpack-options-on-vite`. Pasting `virtualModuleDir`, `hostInitInjectLocation`, `bundleAllCSS`, `remoteHmr`, `varFilename` onto Enhanced is a no-op footgun. Canonical-config already lists some Vite keys. |
| **evidence**           | `src/rules.ts` copied-webpack-options; `src/canonical-config.ts` ignoreOrigin/virtualModuleDir; `apps/docs/docs/configuration-audit.md` Vite-only table                                                                               |
| **suggested PR title** | feat: warn Vite-only federation keys on webpack-family configs                                                                                                                                                                        |
| **acceptance**         | Finding lists the ignored keys. Quiet when none present. Vite projects unaffected.                                                                                                                                                    |

### BL-21 — Standalone Modern findings cell

|                        |                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | tests                                                                                                                                                                                                                          |
| **bundlers**           | modern                                                                                                                                                                                                                         |
| **severity**           | P2                                                                                                                                                                                                                             |
| **effort**             | L                                                                                                                                                                                                                              |
| **score**              | 77                                                                                                                                                                                                                             |
| **why**                | `examples/standalone-findings/` has vite/webpack/rspack/rsbuild red emit cells. Modern is only `examples/compatibility/modern` green smoke (Rspack-under-the-hood). Agents cannot prove Modern emit with intentional findings. |
| **evidence**           | `examples/standalone-findings/README.md`; `examples/compatibility/modern/`                                                                                                                                                     |
| **suggested PR title** | test: add standalone-findings cell for the Modern adapter                                                                                                                                                                      |
| **acceptance**         | A fifth cell (or documented stub using the same afterEmit path) writes `.mf/doctor/report.json` with at least one finding and `failOn: "never"`. Status remains partial.                                                       |

### BL-22 — splitChunks / cacheGroups vs MF runtime

|                        |                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                                                                                                                    |
| **bundlers**           | rspack, webpack, rsbuild                                                                                                                                                                                                                                                                                                                    |
| **severity**           | P2                                                                                                                                                                                                                                                                                                                                          |
| **effort**             | M                                                                                                                                                                                                                                                                                                                                           |
| **score**              | 76                                                                                                                                                                                                                                                                                                                                          |
| **why**                | Vite has `vite/manual-chunks-conflict`. Webpack/Rspack `optimization.splitChunks.chunks = "all"` plus aggressive cacheGroups commonly break MF runtime/shared chunks. MF perf skill mentions splitChunks for Rsbuild/Rspack as a _perf_ hint; the doctor should warn when it **conflicts**, not nag every project to set `chunks: "async"`. |
| **evidence**           | `src/rules.ts` `vite/manual-chunks-conflict`; `.claude/skills/mf/reference/perf.md`; no splitChunks on bundler facts                                                                                                                                                                                                                        |
| **suggested PR title** | feat: advisory when splitChunks cacheGroups target MF runtime                                                                                                                                                                                                                                                                               |
| **acceptance**         | Detect public cacheGroups that match `mf-*` / remoteEntry / shared runtime chunk names when those facts exist. Info/warning, skip when optimization unobserved. Do not implement the perf skill’s blanket “set chunks async” nag.                                                                                                           |

### BL-23 — Stop exporting unused capability-packs from `.`

|                        |                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | overeng                                                                                                                                                                                                                              |
| **bundlers**           | all                                                                                                                                                                                                                                  |
| **severity**           | P2                                                                                                                                                                                                                                   |
| **effort**             | S                                                                                                                                                                                                                                    |
| **score**              | 76                                                                                                                                                                                                                                   |
| **why**                | `src/capability-packs.ts` is imported only by `src/index.ts` and `test/unit/capability-packs.test.ts`. Engine/CLI/plugin never query packs. Premature public API. Prefer un-export (keep file + tests) over inventing engine wiring. |
| **evidence**           | grep `from "./capability-packs` → `src/index.ts` only; `src/capability-packs.ts` `ENHANCED_WEBPACK_V5_BROWSER_PACK`                                                                                                                  |
| **suggested PR title** | chore: stop exporting capability-packs from the root entry                                                                                                                                                                           |
| **acceptance**         | Root `index` no longer re-exports packs. Unit test can import the module directly. Docs/capabilities.md does not claim CLI integration. Semver note if this is considered public.                                                    |

### BL-24 — Duplicate MF plugin registration on Vite/Rsbuild

|                        |                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | coverage                                                                                                                                                                                                                                                                                                                                         |
| **bundlers**           | vite, rsbuild                                                                                                                                                                                                                                                                                                                                    |
| **severity**           | P2                                                                                                                                                                                                                                                                                                                                               |
| **effort**             | M                                                                                                                                                                                                                                                                                                                                                |
| **score**              | 75                                                                                                                                                                                                                                                                                                                                               |
| **why**                | `config/duplicate-plugin-registration` counts Webpack/Rspack plugins via public `.name`. Limitations: Vite/Rsbuild have no count surface. Vite **does** collect federation plugin instances (`collectViteModuleFederationPluginInstances`) for multi-instance — that can feed duplicate-registration vs intentional `moduleFederationInstances`. |
| **evidence**           | `apps/docs/docs/limitations.md` MFDOCTOR-123 table; `src/plugin.ts` `MF_PLUGIN_NAMES` + Vite instance collect ~812; `examples/compatibility/vite-multi-instance/`                                                                                                                                                                                |
| **suggested PR title** | feat: count public Vite/Rsbuild federation plugins for duplicate-registration                                                                                                                                                                                                                                                                    |
| **acceptance**         | Two identical unnamed registrations → finding. Explicit `moduleFederationInstances` with distinct configs → no finding. Multi-instance example stays green.                                                                                                                                                                                      |

### BL-25 — knip (or ts-prune) in CI

|                        |                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | dx                                                                                                                                                                     |
| **bundlers**           | all                                                                                                                                                                    |
| **severity**           | P2                                                                                                                                                                     |
| **effort**             | M                                                                                                                                                                      |
| **score**              | 74                                                                                                                                                                     |
| **why**                | No unused-export tool. Public `.` surface keeps growing (identity, waivers, semantic-graph). A knip config with a tight allowlist prevents re-bloat after BL-18/23/27. |
| **evidence**           | `package.json` scripts/devDependencies — no knip/ts-prune/unimported                                                                                                   |
| **suggested PR title** | chore: add knip unused-export gate                                                                                                                                     |
| **acceptance**         | `pnpm`/`vp` script + CI step. Initial allowlist documented. Fails on new unused exports from `src/index.ts`.                                                           |

### BL-26 — Real Modern.js app-tools CI evidence

|                        |                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                               |
| **bundlers**           | modern                                                                                                                                                                                 |
| **severity**           | P2                                                                                                                                                                                     |
| **effort**             | L                                                                                                                                                                                      |
| **score**              | 74                                                                                                                                                                                     |
| **why**                | Matrix and limitations already say the modern smoke is Rspack-under-the-hood, not `@modern-js/app-tools`. Closed #130 remains the real gap. Do not relabel partial as supported.       |
| **evidence**           | `examples/compatibility/modern/`; `fixtures/compatibility-matrix.json` modern localCi; `apps/docs/docs/compatibility.md` #130 note                                                     |
| **suggested PR title** | test: add Modern.js app-tools production emit cell                                                                                                                                     |
| **acceptance**         | A build using App Tools + `@tonoizer/mfdoctor/modern` writes project.json in CI **or** the matrix note stays partial with a pinned blocker issue. No status upgrade without the build. |

### BL-27 — Slim public identity factories on `.`

|                        |                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | overeng                                                                                                                                                                                                                                                                                                                 |
| **bundlers**           | all                                                                                                                                                                                                                                                                                                                     |
| **severity**           | P2                                                                                                                                                                                                                                                                                                                      |
| **effort**             | M                                                                                                                                                                                                                                                                                                                       |
| **score**              | 73                                                                                                                                                                                                                                                                                                                      |
| **why**                | `src/identity.ts` (~912 LOC) exports many factories. Production `src/` consumers need `createApplicationIdentity` / `unknownIdentity` (`monorepo-identity.ts`) and a few runtime-identity types. Rest is tests + public re-export. ADR 0086 says library-only — keep the module, stop advertising every factory on `.`. |
| **evidence**           | `src/index.ts` identity re-exports; grep `from "./identity.js"`; `docs/adr/0086-correlation-and-governance.md`                                                                                                                                                                                                          |
| **suggested PR title** | chore: narrow identity exports on the root entry                                                                                                                                                                                                                                                                        |
| **acceptance**         | Root export list matches actual engine/CLI needs + a documented `experimental` comment. Deep imports from `src/` in tests still work. No report/fingerprint change.                                                                                                                                                     |

### BL-28 — Rolldown / Vite Plus smoke build

|                        |                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                               |
| **bundlers**           | vite                                                                                                                                                                                                                   |
| **severity**           | P2                                                                                                                                                                                                                     |
| **effort**             | L                                                                                                                                                                                                                      |
| **score**              | 73                                                                                                                                                                                                                     |
| **why**                | Same `@tonoizer/mfdoctor/vite` entry; lifecycle detection is unit-tested. Matrix `rolldown: partial` with no localCi fixture. Empty `writeBundle` → `closeBundle` scan is the Rolldown-specific path agents mis-debug. |
| **evidence**           | `fixtures/compatibility-matrix.json` rolldown; `src/vite-lifecycle.ts`; `test/unit/plugin-vite-lifecycle.test.ts`; `apps/docs/docs/limitations.md`                                                                     |
| **suggested PR title** | test: add Rolldown or Vite Plus production smoke cell                                                                                                                                                                  |
| **acceptance**         | localCi row **or** explicit remaining-blocker comment. Status stays partial until emit evidence exists.                                                                                                                |

### BL-29 — Adapter integration tests that actually emit

|                        |                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | tests                                                                                                                                                                                                                                       |
| **bundlers**           | all                                                                                                                                                                                                                                         |
| **severity**           | P2                                                                                                                                                                                                                                          |
| **effort**             | M                                                                                                                                                                                                                                           |
| **score**              | 72                                                                                                                                                                                                                                          |
| **why**                | `test/integration/adapters.test.ts` + `fixtures/adapters/cases.json` call `analyze()` on temp dirs. Plugin hook tests use fake compilers. Real emit is mixed-federation + standalone demos, not a per-adapter red matrix in integration CI. |
| **evidence**           | `test/integration/adapters.test.ts`; `test/unit/plugin-webpack.test.ts`; `test/unit/plugin-modern.test.ts`; `test/unit/plugin-build-time-only.test.ts`                                                                                      |
| **suggested PR title** | test: assert standalone-findings emit reports in integration CI                                                                                                                                                                             |
| **acceptance**         | Integration (or existing demo:standalone gate) asserts `.mf/doctor/project.json` + expected rule IDs per bundler cell. Mock compiler tests can remain for hook shape.                                                                       |

### BL-30 — Remote `type: promise` / `script` contracts

|                        |                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                       |
| **bundlers**           | all                                                                                                                                                                                                                                            |
| **severity**           | P2                                                                                                                                                                                                                                             |
| **effort**             | M                                                                                                                                                                                                                                              |
| **score**              | 72                                                                                                                                                                                                                                             |
| **why**                | Normalize keeps `remote.type`. Rules care about Vite default `var` (`vite/remotes-prefer-module`) and `config/library-remote-type-mismatch`. Promise remotes without async boundary / init, and `script` vs `module` on Enhanced, are unruled. |
| **evidence**           | `src/normalize.ts` remotes ~101–109; `src/rules.ts` `viteDefaultVarRemotes`; `config/library-remote-type-mismatch`                                                                                                                             |
| **suggested PR title** | feat: advise on promise and script remote types                                                                                                                                                                                                |
| **acceptance**         | `type: "promise"` without asyncStartup/bootstrap → warning. `script` + ESM library mismatch already covered or extended. Unknown types → no crash.                                                                                             |

### BL-31 — Agent banner: evidence v2 is not default

|                        |                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | docs                                                                                                                                                                                                                                                                                              |
| **bundlers**           | all                                                                                                                                                                                                                                                                                               |
| **severity**           | P2                                                                                                                                                                                                                                                                                                |
| **effort**             | S                                                                                                                                                                                                                                                                                                 |
| **score**              | 71                                                                                                                                                                                                                                                                                                |
| **why**                | All 112 rules are migrated, schemas/v2 docs exist, but default rollout is still `legacy` until #87. Agents reading `apps/docs/docs/evidence-aware-rules.md` / ADR 0083 treat V2 as the live report. Short agent note next to this backlog (or a pointer from AGENTS.md) prevents false refactors. |
| **evidence**           | `EVIDENCE_ROLLOUT_V2.md`; `src/evidence-rollout.ts`; `docs/adr/0083-evidence-aware-rule-contract.md`                                                                                                                                                                                              |
| **suggested PR title** | docs: state that evidence v2 rollout stays legacy by default                                                                                                                                                                                                                                      |
| **acceptance**         | One paragraph in AGENTS.md or `docs/agent/` (not a product rewrite). No env default change.                                                                                                                                                                                                       |

### BL-32 — Browser vs SSR remoteEntry pairing

|                        |                                                                                                                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                                                                                 |
| **bundlers**           | vite, rspack                                                                                                                                                                                                                                                                                             |
| **severity**           | P2                                                                                                                                                                                                                                                                                                       |
| **effort**             | M                                                                                                                                                                                                                                                                                                        |
| **score**              | 71                                                                                                                                                                                                                                                                                                       |
| **why**                | SvelteKit `remoteEntry.ssr.js` is a unit contract (false-positive guard). There is no general rule that a **browser** host remote URL pointing at an SSR entry (or the reverse) mismatches `experiments.target` / library. Dual-env Nitro pairing is lifecycle-tested, not a producer/consumer contract. |
| **evidence**           | `fixtures/compatibility-matrix.json` `vite-sveltekit-ssr-entry`; `src/ssr-detect.ts`; `test/unit/ssr-dual-env.test.ts`                                                                                                                                                                                   |
| **suggested PR title** | feat: flag browser remotes that target SSR entries                                                                                                                                                                                                                                                       |
| **acceptance**         | When both sides have targetKind facts, mismatched remoteEntry suffix / target → finding. Missing targetKind → skip/partial, no SvelteKit false positive.                                                                                                                                                 |

### BL-33 — `don'tExpose` / expose filters

|                        |                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                                                                                                  |
| **bundlers**           | webpack, rspack                                                                                                                                                                                                                                                                                                           |
| **severity**           | P2                                                                                                                                                                                                                                                                                                                        |
| **effort**             | M                                                                                                                                                                                                                                                                                                                         |
| **score**              | 70                                                                                                                                                                                                                                                                                                                        |
| **why**                | Exposes normalize to `Record<string, string>` only. Enhanced expose objects can carry filters / don't-expose semantics. Dropped fields mean accidental public exposes with no signal. **Low-medium confidence** on exact upstream option names — confirm against the SDK types cited in CONTRIBUTING before implementing. |
| **evidence**           | `src/normalize.ts` exposes; `src/types.ts` `exposes: Record<string, string>`                                                                                                                                                                                                                                              |
| **suggested PR title** | feat: preserve expose object filters in normalize                                                                                                                                                                                                                                                                         |
| **acceptance**         | Unknown expose object keys recorded as canonical unknown fields. Documented don't-expose / filter, once confirmed, does not appear in public expose list used by `config/expose-key-invalid`.                                                                                                                             |

### BL-34 — Legacy `@module-federation/rspack` vs Enhanced

|                        |                                                                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                            |
| **bundlers**           | rspack                                                                                                                                                                                                                                              |
| **severity**           | P2                                                                                                                                                                                                                                                  |
| **effort**             | M                                                                                                                                                                                                                                                   |
| **score**              | 70                                                                                                                                                                                                                                                  |
| **why**                | Plugin count accepts `RspackModuleFederationPlugin`. `config/plugin-package-mismatch` expects `@module-federation/enhanced` for rspack. Mixing leftover `@module-federation/rspack` with Enhanced options / asyncStartup is a real upgrade footgun. |
| **evidence**           | `src/plugin.ts` `MF_PLUGIN_NAMES`; `src/rules.ts` plugin-package-mismatch ~2195–2209                                                                                                                                                                |
| **suggested PR title** | feat: warn mixed legacy rspack MF package with Enhanced adapter                                                                                                                                                                                     |
| **acceptance**         | Declared `@module-federation/rspack` without enhanced (or both) → warning with expected package. Direct Enhanced-only stays quiet.                                                                                                                  |

### BL-35 — Drop webpack `moduleFederationDoctorPlugin` alias

|                        |                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | dead-code                                                                                                                                                                                    |
| **bundlers**           | webpack                                                                                                                                                                                      |
| **severity**           | P3                                                                                                                                                                                           |
| **effort**             | S                                                                                                                                                                                            |
| **score**              | 70                                                                                                                                                                                           |
| **why**                | Webpack entry exports `ModuleFederationDoctorPlugin` plus deprecated `moduleFederationDoctorPlugin` (Rspack’s name). pack-check equality only. Confuses agents copying the wrong identifier. |
| **evidence**           | `src/webpack.ts`; `scripts/pack-check.mjs`                                                                                                                                                   |
| **suggested PR title** | chore: remove webpack moduleFederationDoctorPlugin alias                                                                                                                                     |
| **acceptance**         | Canonical `ModuleFederationDoctorPlugin` remains. Docs already use it. Semver same caveat as BL-18.                                                                                          |

### BL-36 — Name Next.js as unsupported in limitations

|                        |                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | docs                                                                                                                                                                                                                                      |
| **bundlers**           | all                                                                                                                                                                                                                                       |
| **severity**           | P2                                                                                                                                                                                                                                        |
| **effort**             | S                                                                                                                                                                                                                                         |
| **score**              | 69                                                                                                                                                                                                                                        |
| **why**                | MF skill still mentions `@module-federation/nextjs-mf` (Pages Router, unmaintained). Product limitations discuss runtime-only and Nuxt/Modern partials but never say **NextFederation is out of scope**. Agents may start a Next adapter. |
| **evidence**           | `apps/docs/docs/limitations.md`; `.claude/skills/mf/reference/integrate.md` deprecation; grep `apps/docs` for nextjs — no hits                                                                                                            |
| **suggested PR title** | docs: mark Next.js Module Federation as out of scope                                                                                                                                                                                      |
| **acceptance**         | Limitations + compatibility unsupported row: no Next adapter planned; prefer Rsbuild/Modern. No code adapter.                                                                                                                             |

### BL-37 — Drop Nuxt `nuxtDoctor` / `federationDoctorNuxt` aliases

|                        |                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | dead-code                                                                                                                       |
| **bundlers**           | all                                                                                                                             |
| **severity**           | P3                                                                                                                              |
| **effort**             | S                                                                                                                               |
| **score**              | 69                                                                                                                              |
| **why**                | Extra names only exist for pack-check and `test/unit/nuxt.test.ts`. Public module is `createNuxtDoctorModule` / default export. |
| **evidence**           | `src/nuxt.ts`; `test/unit/nuxt.test.ts`                                                                                         |
| **suggested PR title** | chore: remove Nuxt adapter alias exports                                                                                        |
| **acceptance**         | One public factory + default. Tests updated.                                                                                    |

### BL-38 — Capabilities matrix Nuxt column

|                        |                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | docs                                                                                                                                                                       |
| **bundlers**           | all                                                                                                                                                                        |
| **severity**           | P2                                                                                                                                                                         |
| **effort**             | S                                                                                                                                                                          |
| **score**              | 68                                                                                                                                                                         |
| **why**                | `apps/docs/docs/capabilities.md` table columns skip Nuxt (Vite-family lifecycle applies). Agents comparing bundlers miss that Nuxt is Vite+SSR dual emit. Pair with BL-04. |
| **evidence**           | `apps/docs/docs/capabilities.md` capability table                                                                                                                          |
| **suggested PR title** | docs: add Nuxt column to the capabilities matrix                                                                                                                           |
| **acceptance**         | Nuxt column: same Vite emit hooks via `vite:extendConfig`; partial; dual client/SSR. German locale parity (docs lifecycle).                                                |

### BL-39 — Un-export lineage/waivers from `.` until CLI uses them

|                        |                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | overeng                                                                                                                                                                                                                                                                                   |
| **bundlers**           | all                                                                                                                                                                                                                                                                                       |
| **severity**           | P2                                                                                                                                                                                                                                                                                        |
| **effort**             | M                                                                                                                                                                                                                                                                                         |
| **score**              | 68                                                                                                                                                                                                                                                                                        |
| **why**                | `finding-lineage.ts` (~591) and `governance-waivers.ts` (~641) are wired to each other and v1-compatibility, not to `baseline.ts` / CLI. Public surface implies productized governance. Prefer keep files, drop root re-exports (or document experimental). Do not invent CLI flags here. |
| **evidence**           | `src/index.ts`; `src/governance-waivers.ts`; `src/finding-lineage.ts`; CLI has fingerprint baselines, not these APIs                                                                                                                                                                      |
| **suggested PR title** | chore: treat lineage and waivers as non-CLI library modules                                                                                                                                                                                                                               |
| **acceptance**         | Root export slimmed or marked experimental in `apps/docs/docs/api.md`. Baseline CLI unchanged.                                                                                                                                                                                            |

### BL-40 — Prefix-share / subpath tests on Enhanced

|                        |                                                                                                                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | tests                                                                                                                                                                                                                               |
| **bundlers**           | rspack, webpack                                                                                                                                                                                                                     |
| **severity**           | P2                                                                                                                                                                                                                                  |
| **effort**             | M                                                                                                                                                                                                                                   |
| **score**              | 68                                                                                                                                                                                                                                  |
| **why**                | `shared/prefix-share-recommended` is all-bundler; `shared/subpath-version-unresolved` is Vite-only (parent version inheritance). Enhanced prefix/`react/` behavior is under-tested. Agents copy Vite fixes onto Rspack incorrectly. |
| **evidence**           | `src/rules.ts` ~2399–2424; `test/unit/shared-subpath-version-unresolved.test.ts`; `fixtures/shared-subpath-version/`                                                                                                                |
| **suggested PR title** | test: cover prefix shares on webpack/rspack without Vite inheritance                                                                                                                                                                |
| **acceptance**         | Tests show Enhanced does **not** fire the Vite-only unresolved-version rule (after BL-01). Prefix-share-recommended still fires on deep imports.                                                                                    |

### BL-41 — `mfdoctor rules` proof of per-rule bundlers

|                        |                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | tests                                                                                                                                      |
| **bundlers**           | all                                                                                                                                        |
| **severity**           | P2                                                                                                                                         |
| **effort**             | S                                                                                                                                          |
| **score**              | 67                                                                                                                                         |
| **why**                | Verify-skill `rules` feature does not assert `supportedBundlers`. After BL-01, add one catalog assertion so agents cannot regress the lie. |
| **evidence**           | `.cursor/skills/verify-mfdoctor/features/rules.md`; `.cursor/skills/verify-mfdoctor/evidence/rules/`                                       |
| **suggested PR title** | test: assert Vite-only rules in mfdoctor rules catalog                                                                                     |
| **acceptance**         | Unit or skill evidence: `vite/server-origin.supportedBundlers` is `["vite"]`. Do not rewrite the whole skill file.                         |

### BL-42 — Shared `layer` (low confidence)

|                        |                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                        |
| **bundlers**           | webpack, rspack                                                                                                                                                                                                                 |
| **severity**           | P2                                                                                                                                                                                                                              |
| **effort**             | M                                                                                                                                                                                                                               |
| **score**              | 67                                                                                                                                                                                                                              |
| **why**                | Webpack layer sharing is a real Enhanced/webpack failure mode. **Low confidence** on how often MF users set `layer`. SDK types confirm `layer` / `issuerLayer`; first PR is normalize-and-unknown-field only. |
| **evidence**           | `src/types.ts` `NormalizedShared`; CONTRIBUTING SDK plugin types (`SharedConfig.layer` / `issuerLayer` at module-federation/core@641a0b6). Public [shared docs](https://module-federation.io/configure/shared.html) and Vite normalize do not list `layer`. |
| **suggested PR title** | feat: preserve shared.layer in normalize                                                                                                                                                                                        |
| **acceptance**         | layer round-trips. Cross-layer mismatch rule only if two projects both declare layers; otherwise stop at normalize. Mark rule PR as follow-up if evidence is thin.                                                              |
| **follow-up**          | Normalize + canonical unknown-field recording shipped. **No mismatch rule in this PR:** this repo has no two-project fixture where both sides declare `layer`, public docs omit the option, and Vite ignores it. Revisit only with emit evidence from two webpack-family projects. |

### BL-43 — dts `compilerInstance` / tsgo advisory

|                        |                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                                                                                        |
| **bundlers**           | all                                                                                                                                                                                                                                                                                                             |
| **severity**           | P3                                                                                                                                                                                                                                                                                                              |
| **effort**             | M                                                                                                                                                                                                                                                                                                               |
| **score**              | 66                                                                                                                                                                                                                                                                                                              |
| **why**                | MF perf skill walks `dts.generateTypes.compilerInstance = "tsgo"`. Doctor only checks outputDir / dts disabled. A **perf info** rule is optional and easy to over-nag. Prefer documenting in configuration-audit first, rule only if dts generation is observed slow — **low confidence** as a default warning. |
| **evidence**           | `.claude/skills/mf/reference/perf.md`; `src/rules.ts` `generateTypesOptions`                                                                                                                                                                                                                                    |
| **suggested PR title** | docs: mention tsgo compilerInstance on the DTS audit page                                                                                                                                                                                                                                                       |
| **acceptance**         | Configuration-audit row. Optional later info rule behind recommended profile, not error.                                                                                                                                                                                                                        |

### BL-44 — Modern smoke README: not full app-tools

|                        |                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | docs                                                                                                                                                                                        |
| **bundlers**           | modern                                                                                                                                                                                      |
| **severity**           | P2                                                                                                                                                                                          |
| **effort**             | S                                                                                                                                                                                           |
| **score**              | 66                                                                                                                                                                                          |
| **why**                | Agents treat `examples/compatibility/modern` green as full Modern support. README should shout Rspack-stub + #130 in the first paragraph (if not already loud enough — verify and tighten). |
| **evidence**           | `examples/compatibility/modern/README.md`; matrix modern coverage string                                                                                                                    |
| **suggested PR title** | docs: lead Modern smoke README with partial-status warning                                                                                                                                  |
| **acceptance**         | First paragraph: partial, not app-tools, do not claim supported.                                                                                                                            |

### BL-45 — transformImport facts from Modern adapter

|                        |                                                                                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | tests                                                                                                                                                                                                                                           |
| **bundlers**           | modern                                                                                                                                                                                                                                          |
| **severity**           | P2                                                                                                                                                                                                                                              |
| **effort**             | M                                                                                                                                                                                                                                               |
| **score**              | 65                                                                                                                                                                                                                                              |
| **why**                | `config/transform-import-share-conflict` skips when library facts are unknown. Modern/Rsbuild are the bundlers that ship `source.transformImport`. Unit tests use synthetic facts more than adapter wiring. Silent skip on real Modern configs. |
| **evidence**           | `src/rule-inventory.ts` transform-import plan; `src/modern.ts`; `src/rsbuild.ts`; `test/unit/rules.test.ts`                                                                                                                                     |
| **suggested PR title** | test: prove Modern/Rsbuild adapters pass transformImport libraries                                                                                                                                                                              |
| **acceptance**         | Adapter test with public transformImport + shared antd/arco-style package emits the rule (or documented skip).                                                                                                                                  |

### BL-46 — `RULE_COMPATIBILITY_EXCEPTIONS` empty noise

|                        |                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **category**           | dead-code                                                                                                                                                                            |
| **bundlers**           | all                                                                                                                                                                                  |
| **severity**           | P3                                                                                                                                                                                   |
| **effort**             | S                                                                                                                                                                                    |
| **score**              | 65                                                                                                                                                                                   |
| **why**                | Empty array “by design for V1 closeout” is still public and tested. Either delete the export or keep a one-line comment in inventory without a public type if nothing will be added. |
| **evidence**           | `src/rule-inventory.ts` ~20–23; `test/unit/rule-inventory-closeout.test.ts`                                                                                                          |
| **suggested PR title** | chore: drop empty RULE_COMPATIBILITY_EXCEPTIONS export                                                                                                                               |
| **acceptance**         | Closeout test still proves every built-in is migrated without a public empty list.                                                                                                   |

### BL-47 — `output.uniqueName` vs MF `name`

|                        |                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                |
| **bundlers**           | webpack, rspack                                                                                                                                                                                                                         |
| **severity**           | P2                                                                                                                                                                                                                                      |
| **effort**             | S                                                                                                                                                                                                                                       |
| **score**              | 64                                                                                                                                                                                                                                      |
| **why**                | Webpack smoke sets `uniqueName`. Federation `name-conflict` is cross-project. A single compiler with `output.uniqueName` ≠ MF `name` causes global/runtime surprises. **Medium confidence** — uniqueName is often set equal on purpose. |
| **evidence**           | `examples/compatibility/webpack/webpack.config.mjs`; `src/plugin.ts` compiler options                                                                                                                                                   |
| **suggested PR title** | feat: info when output.uniqueName disagrees with federation name                                                                                                                                                                        |
| **acceptance**         | Info finding when both observed and unequal. Quiet when uniqueName absent. Webpack smoke stays green (aligned).                                                                                                                         |

### BL-48 — SSR host-init analogues on Rsbuild/Modern

|                        |                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                              |
| **bundlers**           | rsbuild, modern                                                                                                                                                                                                                       |
| **severity**           | P2                                                                                                                                                                                                                                    |
| **effort**             | M                                                                                                                                                                                                                                     |
| **score**              | 63                                                                                                                                                                                                                                    |
| **why**                | `vite/host-init-inject-ssr` is Vite-specific. Modern.js / Rsbuild SSR hosts have different inject points. **Low-medium confidence** without a failing fixture — start with docs + skip reason, then a rule if a public option exists. |
| **evidence**           | `src/rules.ts` `vite/host-init-inject-ssr`; `apps/docs/docs/vite-integration.md`                                                                                                                                                      |
| **suggested PR title** | docs: document SSR host-init as Vite-only until Rsbuild/Modern facts exist                                                                                                                                                            |
| **acceptance**         | Limitations or vite-integration cross-link. No fake Rsbuild finding. Follow-up rule only with a public option + fixture.                                                                                                              |

### BL-49 — Un-export `projectV1Suppression`

|                        |                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **category**           | overeng                                                                                                                     |
| **bundlers**           | all                                                                                                                         |
| **severity**           | P2                                                                                                                          |
| **effort**             | S                                                                                                                           |
| **score**              | 62                                                                                                                          |
| **why**                | `src/v1-compatibility.ts` is tests/docs/ADR only. Not used by baseline CLI. Dead compatibility layer on the public surface. |
| **evidence**           | grep `projectV1Suppression` / `v1-compatibility`; `src/index.ts`                                                            |
| **suggested PR title** | chore: stop exporting unused v1-compatibility helpers                                                                       |
| **acceptance**         | Module can remain for ADR tests via relative import. Root `.` export gone.                                                  |

### BL-50 — Stats expected (Enhanced) vs unexpected (Vite)

|                        |                                                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                                                                                               |
| **bundlers**           | all                                                                                                                                                                                                                                                                                    |
| **severity**           | P2                                                                                                                                                                                                                                                                                     |
| **effort**             | M                                                                                                                                                                                                                                                                                      |
| **score**              | 61                                                                                                                                                                                                                                                                                     |
| **why**                | Capabilities/runtime-manifests already explain Vite opt-in vs Enhanced default. Rules focus on manifest disabled/assets, not “Enhanced build with stats:false” vs “Vite with stats present”. Easy to over-warn. Prefer tightening `doctor/partial-analysis` messages over a new error. |
| **evidence**           | `apps/docs/docs/capabilities.md` Manifest row; `apps/docs/docs/runtime-manifests.md`; `artifact/manifest-*` rules                                                                                                                                                                      |
| **suggested PR title** | fix: incompleteReasons when Enhanced stats are off but remotes exist                                                                                                                                                                                                                   |
| **acceptance**         | Enhanced/Rspack/Webpack with remotes and stats capability false → incomplete reason or existing manifest rule. Vite without manifest stays the documented opt-in path.                                                                                                                 |

### BL-51 — Share evidence projection helpers (do not merge runners)

|                        |                                                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | overeng                                                                                                                                                                                                                                                                      |
| **bundlers**           | all                                                                                                                                                                                                                                                                          |
| **severity**           | P2                                                                                                                                                                                                                                                                           |
| **effort**             | L                                                                                                                                                                                                                                                                            |
| **score**              | 61                                                                                                                                                                                                                                                                           |
| **why**                | `evidence-rule-bridge.ts` (~672) and `evidence-federation-bridge.ts` (~271) duplicate shapes; both use `evidence-graph-projection.ts`. A **helper extract** is a mini-PR. Merging the runners or flipping rollout defaults is the architecture rewrite this backlog forbids. |
| **evidence**           | `src/evidence-rule-bridge.ts`; `src/evidence-federation-bridge.ts`; `src/evidence-graph-projection.ts`; `EVIDENCE_ROLLOUT_V2.md`                                                                                                                                             |
| **suggested PR title** | refactor: share evidence projection helpers between bridges                                                                                                                                                                                                                  |
| **acceptance**         | Net LOC down, tests green, no rollout default change, no report fingerprint change.                                                                                                                                                                                          |

### BL-52 — Mark semantic-graph / identity APIs experimental

|                        |                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | docs                                                                                                                                                                                                                                  |
| **bundlers**           | all                                                                                                                                                                                                                                   |
| **severity**           | P3                                                                                                                                                                                                                                    |
| **effort**             | S                                                                                                                                                                                                                                     |
| **score**              | 60                                                                                                                                                                                                                                    |
| **why**                | `apps/docs/docs/capabilities.md` already demotes 1.1.0 library contracts, but `src/index.ts` still looks like a second product. A one-line `@experimental` in api.md + index comment stops agents from “finishing” graph integration. |
| **evidence**           | `src/semantic-graph.ts`; `apps/docs/docs/api.md`; `docs/adr/0086-correlation-and-governance.md`                                                                                                                                       |
| **suggested PR title** | docs: label semantic-graph and identity correlation experimental                                                                                                                                                                      |
| **acceptance**         | api.md + index file comment. No runtime change.                                                                                                                                                                                       |

### BL-53 — `ignoreOrigin` / `virtualModuleDir` honest skips

|                        |                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                           |
| **bundlers**           | vite                                                                                                                                                                               |
| **severity**           | P3                                                                                                                                                                                 |
| **effort**             | M                                                                                                                                                                                  |
| **score**              | 59                                                                                                                                                                                 |
| **why**                | Normalized and listed in configuration-audit as Vite risks. No rules. Virtual dir with slashes / ignoreOrigin without a tested base are footguns. Low urgency vs alias/publicPath. |
| **evidence**           | `src/normalize.ts` ~194–195; `apps/docs/docs/configuration-audit.md` Vite-only table                                                                                               |
| **suggested PR title** | feat: warn invalid virtualModuleDir and untested ignoreOrigin                                                                                                                      |
| **acceptance**         | Slash in virtualModuleDir → warning. ignoreOrigin true without server.origin fact → info/partial.                                                                                  |

### BL-54 — Split `src/capture.ts` (~3.7k LOC)

|                        |                                                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | overeng                                                                                                                                                                                                                                                                      |
| **bundlers**           | all                                                                                                                                                                                                                                                                          |
| **severity**           | P2                                                                                                                                                                                                                                                                           |
| **effort**             | L                                                                                                                                                                                                                                                                            |
| **score**              | 58                                                                                                                                                                                                                                                                           |
| **why**                | Largest source file. CLI `runtime` uses a slice via `runtime-trace.ts`; `@tonoizer/mfdoctor/capture` documents browser/network fallbacks that are easy to confuse with an in-browser doctor (non-goal). Split along file-import vs unused transports; do not add transports. |
| **evidence**           | `src/capture.ts` wc ~3742; `src/runtime-trace.ts`; `apps/docs/docs/runtime-capture.md`; `package.json` `./capture` export                                                                                                                                                    |
| **suggested PR title** | refactor: split runtime-capture file-import from unused transports                                                                                                                                                                                                           |
| **acceptance**         | File-import path used by `mfdoctor runtime` in a smaller module. Unused transports deleted **or** isolated with tests. No in-browser injection. ADR 0084 closeout not in scope.                                                                                              |

### BL-55 — Internalize `MIGRATED_GROUP*` exports

|                        |                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------ |
| **category**           | dead-code                                                                            |
| **bundlers**           | all                                                                                  |
| **severity**           | P3                                                                                   |
| **effort**             | S                                                                                    |
| **score**              | 55                                                                                   |
| **why**                | Group id arrays are migration archaeology. Needed by bridges/tests, not app authors. |
| **evidence**           | `src/index.ts` `MIGRATED_GROUP1_*` … `GROUP6`; `src/rule-inventory.ts`               |
| **suggested PR title** | chore: stop exporting migrated rule-group constants                                  |
| **acceptance**         | Bridges import from `rule-inventory.js` internally. Root `.` export gone.            |

### BL-56 — `buildUiPayload` is not an HTML UI

|                        |                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | docs                                                                                                                                                                                                           |
| **bundlers**           | all                                                                                                                                                                                                            |
| **severity**           | P3                                                                                                                                                                                                             |
| **effort**             | S                                                                                                                                                                                                              |
| **score**              | 54                                                                                                                                                                                                             |
| **why**                | limitations.md already says no dashboard; `schemas/ui.schema.json` remains. Agents still grep `ui` and invent `--ui`. A single cross-link from api.md / this backlog is enough — **do not** delete the schema. |
| **evidence**           | `apps/docs/docs/limitations.md`; `src/ui-graph.ts`; `schemas/ui.schema.json`                                                                                                                                   |
| **suggested PR title** | docs: stress that ui schema is not a shipped dashboard                                                                                                                                                         |
| **acceptance**         | api.md one-liner. Schema kept.                                                                                                                                                                                 |

### BL-57 — `dataPrefetch` / prefetch remotes (low confidence)

|                        |                                                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **category**           | coverage                                                                                                                                                                                                              |
| **bundlers**           | all                                                                                                                                                                                                                   |
| **severity**           | P3                                                                                                                                                                                                                    |
| **effort**             | L                                                                                                                                                                                                                     |
| **score**              | 52                                                                                                                                                                                                                    |
| **why**                | Prefetch/preload misconfig can break load order. No normalize field. Easy to over-build. **Low confidence** — confirm option is still public and failure-prone before a rule. Prefer a configuration-audit row first. |
| **evidence**           | configuration-audit (no prefetch row); runtime-plugin createLink guidance only                                                                                                                                        |
| **suggested PR title** | docs: add dataPrefetch to the configuration audit checklist                                                                                                                                                           |
| **acceptance**         | Audit table row with official docs link. Rule only in a later PR with a fixture.                                                                                                                                      |

### BL-58 — Un-export `DEFAULT_ANALYSIS_CACHE_OPTIONS`

|                        |                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| **category**           | dead-code                                                                                   |
| **bundlers**           | all                                                                                         |
| **severity**           | P3                                                                                          |
| **effort**             | S                                                                                           |
| **score**              | 48                                                                                          |
| **why**                | Cache class is used by collect/benchmarks. Default const is only re-exported. Tiny hygiene. |
| **evidence**           | `src/analysis-cache.ts`; `src/index.ts`                                                     |
| **suggested PR title** | chore: un-export DEFAULT_ANALYSIS_CACHE_OPTIONS                                             |
| **acceptance**         | Internal default remains. Public type `AnalysisCacheOptions` can stay.                      |

---

## Coverage map vs MF surfaces (quick)

| MF surface                                                | Doctor today                    | Backlog IDs                                        |
| --------------------------------------------------------- | ------------------------------- | -------------------------------------------------- |
| shared singleton / eager / requiredVersion / import:false | Strong                          | BL-07, BL-14, BL-42                                |
| shareStrategy host↔remote                                 | Rule exists; defaulting lies    | BL-08                                              |
| remotes URL / manifest / localhost / http                 | Strong                          | BL-30                                              |
| exposes `./` key + path                                   | Strong                          | BL-33                                              |
| dts generateTypes outputDir / disabled                    | Strong                          | BL-16, BL-19, BL-43                                |
| manifest / stats / getPublicPath                          | Strong on Enhanced; Vite opt-in | BL-05, BL-50                                       |
| runtimePlugins createScript / CORS / factory              | Rules + fixtures                | BL-17                                              |
| experiments.asyncStartup                                  | Used, no Rspack version         | BL-09                                              |
| Vite alias / manualChunks / hashed filename / HMR / Nitro | Vite-only rules                 | BL-06, BL-12, BL-13, BL-20, BL-22                  |
| Bridge React/Vue                                          | Rules + unit                    | BL-15                                              |
| SSR node plugin / react-dom/server in web                 | Rules + fixtures                | BL-17, BL-32, BL-48                                |
| Nuxt / Modern / Rolldown                                  | Partial adapters                | BL-04, BL-11, BL-21, BL-26, BL-28, BL-38, BL-44    |
| Next.js                                                   | Unmentioned                     | BL-36                                              |
| Identity / graph / waivers / capture                      | Library                         | BL-23, BL-27, BL-31, BL-39, BL-49, BL-51–52, BL-54 |

---

## Suggested PR slicing (later runs)

Each backlog ID is intended as **one PR**. Do not batch Vite dialect rules
with knip, or Nuxt examples with evidence-bridge refactors.

Safe first week of mini-PRs (no architecture fight):

1. BL-01, BL-02, BL-04, BL-08 (correctness + honesty)
2. BL-03, BL-10, BL-12, BL-15, BL-17 (agent fixtures)
3. BL-05, BL-06, BL-07, BL-09, BL-14 (Enhanced/Vite coverage)
4. BL-18, BL-23, BL-25, BL-46 (delete/slim)

Release stays human: no version bump for this document.
