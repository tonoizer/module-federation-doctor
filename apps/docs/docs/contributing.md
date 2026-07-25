# Contributing

Use Node `>=22.12.0` and pnpm 11. Run `pnpm install
--frozen-lockfile`, then `pnpm check`. Add behavior tests for rules and adapters.
Run `pnpm changeset` for a public package change.

## Roadmap

- **[v1.0](https://github.com/tonoizer/module-federation-doctor/milestone/1)** —
  governance-ready Doctor (Webpack + CI federation gate + policy packs +
  baselines + npm publish). Epic:
  [#30](https://github.com/tonoizer/module-federation-doctor/issues/30).
- **[post-v1](https://github.com/tonoizer/module-federation-doctor/milestone/2)** —
  later adapters and coverage expansions. Not release blockers for v1.0 or the
  upstream maintainer conversation.

Close the matching GitHub issue and drop the row from
[limitations](./limitations.md) when work ships.

### v1.0

| ID             | Issue                                                                 | Topic                                               |
| -------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `MFDOCTOR-101` | [#10](https://github.com/tonoizer/module-federation-doctor/issues/10) | Webpack adapter                                     |
| `MFDOCTOR-109` | [#25](https://github.com/tonoizer/module-federation-doctor/issues/25) | One-shot workspace federation gate for CI           |
| `MFDOCTOR-110` | [#26](https://github.com/tonoizer/module-federation-doctor/issues/26) | Shareable policy packs and named presets            |
| `MFDOCTOR-111` | [#27](https://github.com/tonoizer/module-federation-doctor/issues/27) | Fingerprint baselines and suppressions              |
| —              | [#18](https://github.com/tonoizer/module-federation-doctor/issues/18) | Document permanent non-goal (private MF fields)     |
| `MFDOCTOR-112` | [#28](https://github.com/tonoizer/module-federation-doctor/issues/28) | First public npm publish _(after product items)_    |
| `MFDOCTOR-113` | [#29](https://github.com/tonoizer/module-federation-doctor/issues/29) | Propose Doctor to official MF org _(after publish)_ |

### post-v1

| ID             | Issue                                                                 | Topic                                                    |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `MFDOCTOR-102` | [#11](https://github.com/tonoizer/module-federation-doctor/issues/11) | Rolldown and Vite Plus lifecycle coverage                |
| `MFDOCTOR-103` | [#12](https://github.com/tonoizer/module-federation-doctor/issues/12) | Modern.js adapter without hiding direct Rspack           |
| `MFDOCTOR-105` | [#14](https://github.com/tonoizer/module-federation-doctor/issues/14) | Runtime / dynamic imports beyond static analysis         |
| `MFDOCTOR-106` | [#15](https://github.com/tonoizer/module-federation-doctor/issues/15) | Broader Node, bundler, framework, package-manager matrix |

`MFDOCTOR-104` / [#13](https://github.com/tonoizer/module-federation-doctor/issues/13)
(HTML analysis UI) was closed as not planned — Doctor does not ship an HTML
dashboard.

Permanent non-goal: no undocumented private Module Federation plugin fields —
[#18](https://github.com/tonoizer/module-federation-doctor/issues/18).
