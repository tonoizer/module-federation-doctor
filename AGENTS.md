# MFDoctor agent playbook

Use this when installing or running `@tonoizer/mfdoctor` to diagnose or fix
Module Federation issues. Prefer this package's CLI/plugin output over guessing.

After `pnpm add -D @tonoizer/mfdoctor`, this file ships at
`node_modules/@tonoizer/mfdoctor/AGENTS.md`. The same playbook is also packaged
as a Cursor/agent skill at `skills/mfdoctor/SKILL.md`.

## Intended loop

1. **capabilities** — discover the versioned CLI contract (no project config, no
   network):

   ```bash
   mfdoctor capabilities
   ```

2. **check (JSON)** — run offline analysis and keep machine-readable artifacts
   on disk (do not scrape ANSI terminal output):

   ```bash
   mfdoctor check --ci --format terminal,json,sarif \
     --diagnostics-dir .mf/doctor/diagnostics
   ```

3. **prompt** — load structured fix guidance for a finding from the saved
   report:

   ```bash
   mfdoctor prompt --finding <ruleId|fingerprint> .mf/doctor/report.json
   ```

4. **rebuild / re-check** — apply a narrow fix for that finding, rebuild with a
   MFDoctor adapter when emit evidence is needed, then re-run `check` (and
   `workspace` / `federation` in monorepos) until policy passes.

## Hard rules

- **No suppressions unless the user asked.** Do not add baselines, severity
  overrides, rule `off`, governance waivers, or allowlists to clear findings
  unless the user explicitly requested suppressions or accepted debt.
- **No probe unless the user asked.** `mfdoctor probe` is the only network
  command. Do not probe deployed manifests, CDN URLs, or remoteEntry endpoints
  unless the user asked.
- **Do not claim green from `check` alone.** Offline `check` is config/static
  analysis. Before claiming green, require plugin emit evidence (a build with a
  MFDoctor adapter that writes `.mf/doctor/project.json`) and, in monorepos, the
  workspace/federation gate. Treat exit code `2` and `doctor/partial-analysis`
  as incomplete analysis — not a pass.

## Exit codes

| Code | Meaning              |
| ---- | -------------------- |
| `0`  | Policy passed        |
| `1`  | Policy failed         |
| `2`  | Analysis incomplete   |

## Out of scope (do not invent)

MFDoctor does not ship or expect agents to invent:

- MCP servers for MFDoctor
- VS Code problem matchers
- `check --watch`
- HTML UI / `--ui` dashboard
- In-browser doctor / runtime agent injection
- A general `--fix` that mutates the project without a finding-driven change

For Module Federation concepts (shared, remotes, Bridge, observability), use the
upstream `mf` skill — not this playbook.
