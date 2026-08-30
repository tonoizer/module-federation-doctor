---
title: Agenten-Schleife
description: Zweistufige MFDoctor-Schleife — mfdoctor check vs. Plugin-Emit plus Workspace, bevor Grün beansprucht wird.
---

<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Agenten-Schleife

Agents often treat a clean `mfdoctor check` as a full green bill of health. That
is wrong. Offline `check` is **tier 1** (config / static). **Tier 2** is plugin
emit on a real build plus the workspace gate. Claim green only after both tiers
pass, and never treat incomplete analysis as a pass.

## Zwei Stufen

| Tier                     | What to run                                                                            | What it proves                                                                        | What it does **not** prove                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **1 — Config / static**  | `mfdoctor check` (JSON/SARIF + diagnostics when handing off)                           | Offline config, imports, and other facts available without a bundler emit             | Emitted manifests, stats, assets, or cross-app federation contracts                              |
| **2 — Emit + workspace** | Build with a MFDoctor adapter, then `mfdoctor workspace` (or `federation --workspace`) | Post-emit project facts (`.mf/doctor/project.json`) and host↔remote / shared topology | Nothing further is required for a local/CI green claim; optional `runtime` / `probe` stay opt-in |

Hard rule: **do not claim green from `mfdoctor check` alone.**

## Vorgesehene Schleife

1. Discover the versioned CLI contract (no project config, no network):

   ```bash
   mfdoctor capabilities
   ```

2. Run tier 1 and keep machine-readable artifacts (do not scrape ANSI terminal
   output):

   ```bash
   mfdoctor check --ci --format terminal,json,sarif \
     --diagnostics-dir .mf/doctor/diagnostics
   ```

3. Load structured fix guidance when needed:

   ```bash
   mfdoctor prompt --finding <ruleId|fingerprint> .mf/doctor/report.json
   ```

4. Apply a narrow fix for that finding. Rebuild with a MFDoctor adapter so emit
   evidence exists, then re-run tier 1 as needed.

5. **Before claiming green**, finish tier 2:

   ```bash
   # each host/remote already built with its MFDoctor adapter
   mfdoctor workspace
   # or: mfdoctor federation --workspace
   ```

Quiet success prints nothing. Exit codes: `0` policy passed, `1` policy failed,
`2` analysis incomplete.

## `doctor/partial-analysis` ist kein Grün

[`doctor/partial-analysis`](./rules/doctor/partial-analysis.md) means MFDoctor
lacked facts it needed — missing MF options, unresolved dynamic imports, unread
sources, budget-limited projects, omitted workspace projects, or missing emit
capabilities (for example Vite without `manifest: true`).

Treat it as **incomplete analysis**, not a soft warning you can ignore:

- Do not claim green while a non-suppressed `doctor/partial-analysis` remains.
- Exit code `2` means analysis incomplete — same rule: not a pass.
- Prefer restoring evidence (pass `moduleFederation`, enable emit/manifests,
  fix source reads, raise budgets, or use an opt-in runtime trace) over muting
  the rule. Suppress only when the user asked for intentional governance.

Rules that depend on absent evidence stay honest: for example unresolved
package-capable dynamics suppress false `shared/unused` certainty in favor of
partial analysis. See the
[capability matrix](./capabilities.md#dynamic-import-completeness-v1).

## Wen das unterstützt

| Audience  | Takeaway                                                                |
| --------- | ----------------------------------------------------------------------- |
| **Agent** | “Am I done?” = tier 1 **and** tier 2; partial analysis blocks green     |
| **Human** | `check` ≠ plugin emit ≠ workspace; the plugin remains the primary DX    |
| **CI**    | Why builds register adapters and why a workspace job follows app builds |

## Außerhalb des Umfangs (nicht erfinden)

MFDoctor does not ship, and agents must not invent:

- HTML UI / `--ui` dashboard
- In-browser doctor or runtime agent injection
- A general `--fix` that mutates the project without a finding-driven change
- MCP servers, VS Code problem matchers, or `check --watch` (tracked separately)

For Module Federation concepts (shared, remotes, Bridge, observability), use the
upstream `mf` skill. For MFDoctor commands, formats, and exit codes, see the
[CLI reference](./cli.md) and [Get started](./setup.md).
