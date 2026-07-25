# Limitations

MVP supports Vite, direct Rspack, and Rsbuild. The gaps below are tracked as
GitHub issues so each one can be removed from this page when it ships.

## Follow-up work

| Gap                                                          | Issue                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Webpack adapter and compatibility matrix                     | [#10](https://github.com/tonoizer/module-federation-doctor/issues/10) (`MFDOCTOR-101`) |
| Rolldown and Vite Plus lifecycle coverage                    | [#11](https://github.com/tonoizer/module-federation-doctor/issues/11) (`MFDOCTOR-102`) |
| Modern.js adapter (without hiding direct Rspack)             | [#12](https://github.com/tonoizer/module-federation-doctor/issues/12) (`MFDOCTOR-103`) |
| HTML analysis UI beyond the portable report                  | [#13](https://github.com/tonoizer/module-federation-doctor/issues/13) (`MFDOCTOR-104`) |
| Runtime / dynamic imports beyond static analysis             | [#14](https://github.com/tonoizer/module-federation-doctor/issues/14) (`MFDOCTOR-105`) |
| Broader Node, bundler, framework, and package-manager matrix | [#15](https://github.com/tonoizer/module-federation-doctor/issues/15) (`MFDOCTOR-106`) |

Opt-in browser runtime trace import is available through `mfdoctor runtime` when
you supply an Observability Plugin export. Default `check` and `federation`
analysis stay offline.

## Permanent guarantees / non-goals

Doctor does not rely on undocumented private Module Federation plugin fields.
That is a stability guarantee and permanent non-goal, not removable follow-up
work. See [#18](https://github.com/tonoizer/module-federation-doctor/issues/18).

Adapters and rules use **public Module Federation options**, emitted
**manifests**, **stats**, and **recorded capabilities** only. They must not
scrape private plugin instance state, undocumented internals, or other
non-public compiler/plugin fields. Missing optional public input yields
`doctor/partial-analysis` instead of reaching into private MF plugin state.

Adapter authors: see
[architecture notes](./contributing.md#architecture-notes).
