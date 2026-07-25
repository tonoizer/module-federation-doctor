# Fingerprint baselines

Baselines let teams turn on CI `failOn` without fixing every legacy finding on
day one. New fingerprints still fail the gate; known debt is tracked in a
checked-in file and should shrink over time.

For whole-rule `"off"`, severity overrides, packs, and `failOn`, see
[Suppressions and allowlists](./suppressions.md).

**Baselines are debt, not a permanent mute.** Prefer fixing findings. Use a
baseline only for incremental adoption, and prune entries as debt is paid. Do
not add per-line `eslint-disable`-style source comments — fingerprint baselines
are enough for v1.

## File format

Check in `mfdoctor.baseline.json` (JSON only; JSON Schema:
`@module-federation/doctor/schemas/baseline.schema.json`):

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "fingerprint": "a1b2c3…",
      "ruleId": "shared/singleton-mismatch",
      "project": "host",
      "reason": "Legacy singleton until shared migration lands"
    }
  ]
}
```

Each entry is keyed by finding `fingerprint`. Optional `ruleId` and `project`
narrow the match (both must agree when present). Optional `reason` is copied
onto the finding as `suppressionReason` for reports.

## Generate and update

1. Run Doctor so `.mf/doctor/report.json` exists (plugin build or
   `mfdoctor check` / `mfdoctor federation`).
2. Create a baseline from that report:

```bash
mfdoctor baseline generate .mf/doctor/report.json --out mfdoctor.baseline.json
```

3. After more findings appear, merge them into the baseline without removing
   existing entries:

```bash
mfdoctor baseline update .mf/doctor/report.json --out mfdoctor.baseline.json
```

4. When debt is paid, drop unused fingerprints:

```bash
mfdoctor baseline prune .mf/doctor/report.json --out mfdoctor.baseline.json
```

Defaults: report path `.mf/doctor/report.json`, output `mfdoctor.baseline.json`.

## Apply on check, federation, and plugins

Config (`mfdoctor.config.ts` or plugin options):

```ts
export default {
  baseline: "./mfdoctor.baseline.json",
  // or:
  // baseline: { path: "./mfdoctor.baseline.json", failOnSuppressed: false, reportStale: true },
};
```

CLI:

```bash
mfdoctor check --ci --baseline ./mfdoctor.baseline.json
mfdoctor federation ".mf/doctor/**/project.json" --baseline ./mfdoctor.baseline.json
```

Plugin CI runs use the same `DoctorOptions.baseline` field:

```ts
federationDoctor({
  moduleFederation: mfOptions,
  baseline: "./mfdoctor.baseline.json",
});
```

## Policy behavior

- Matched findings stay in terminal, JSON, and SARIF reports, marked
  `suppressed: true` (SARIF `suppressions` with kind `external`).
- By default they **do not** fail `failOn` policy.
- Set `baseline.failOnSuppressed: true` if suppressed findings should still
  fail the gate.
- Unused baseline fingerprints emit `doctor/stale-baseline` info findings when
  `reportStale` is true (default). Remove those entries — the debt is paid.

## Incremental adoption recipe

1. Enable the Doctor plugin and collect a full report with `failOn: "never"`
   (or local defaults).
2. `mfdoctor baseline generate` and commit the file.
3. Turn on CI `failOn: "error"` (or rely on CI auto-detect).
4. Fix or intentionally baseline only new regressions; prune as you clear debt.
5. Treat a growing baseline as a process smell — shrink it.
