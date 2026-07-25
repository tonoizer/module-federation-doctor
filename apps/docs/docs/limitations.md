# Limitations

MVP supports Vite, direct Rspack, and Rsbuild. Gaps below are tracked as GitHub
issues and milestones so each one can be removed from this page when it ships.

Roadmap: [v1.0](https://github.com/tonoizer/module-federation-doctor/milestone/1)
· [post-v1](https://github.com/tonoizer/module-federation-doctor/milestone/2)
· epic [#30](https://github.com/tonoizer/module-federation-doctor/issues/30).

## v1.0 (governance-ready)

| Gap                                                | Issue                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Webpack adapter and compatibility matrix           | [#10](https://github.com/tonoizer/module-federation-doctor/issues/10) (`MFDOCTOR-101`) |
| Dynamic-import completeness beyond static analysis | [#14](https://github.com/tonoizer/module-federation-doctor/issues/14) (`MFDOCTOR-105`) |
| Compatibility matrix for v1 bundlers and runtimes  | [#15](https://github.com/tonoizer/module-federation-doctor/issues/15) (`MFDOCTOR-106`) |
| One-shot workspace federation gate for CI          | [#25](https://github.com/tonoizer/module-federation-doctor/issues/25) (`MFDOCTOR-109`) |
| Shareable policy packs and named presets           | [#26](https://github.com/tonoizer/module-federation-doctor/issues/26) (`MFDOCTOR-110`) |
| Fingerprint baselines and suppressions             | [#27](https://github.com/tonoizer/module-federation-doctor/issues/27) (`MFDOCTOR-111`) |

Static imports cannot see every runtime import until `MFDOCTOR-105` lands its
documented completeness bar (supported dynamic patterns + honest
`doctor/partial-analysis` — not a claim of 100% arbitrary runtime JS).

Cross-app host↔remote shared/integration issues still need each app's
`.mf/doctor/project.json` plus `mfdoctor federation` (or the workspace gate in
`MFDOCTOR-109`). Opt-in `mfdoctor probe` inspects a deployed manifest.

Opt-in browser runtime trace import is available through `mfdoctor runtime` when
you supply an Observability Plugin export. Default `check` and `federation`
analysis stay offline.

Doctor does not ship an HTML dashboard. Use terminal, JSON, and SARIF reports.

## post-v1

| Gap                                              | Issue                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Rolldown and Vite Plus lifecycle coverage        | [#11](https://github.com/tonoizer/module-federation-doctor/issues/11) (`MFDOCTOR-102`) |
| Modern.js adapter (without hiding direct Rspack) | [#12](https://github.com/tonoizer/module-federation-doctor/issues/12) (`MFDOCTOR-103`) |

## Permanent guarantee

Doctor does not rely on undocumented private Module Federation plugin fields.
That is a stability non-goal, not removable follow-up work. See
[#18](https://github.com/tonoizer/module-federation-doctor/issues/18).
