---
name: mfdoctor
description: Audit Module Federation projects with Module Federation Doctor. Use for config review, Vite/Rspack/Rsbuild integration checks, shared dependency conflicts, manifest/stats/type output review, cross-project federation analysis, performance checks, runtime evidence correlation, or production-readiness work in this repository.
---

# Module Federation Doctor

Use evidence from config, emitted artifacts, and cross-project reports. Do not
guess from package names alone.

## Workflow

1. Find the project root and package manager.
2. Identify the bundler and official MF integration.
3. Reuse the exact MF options object in the Doctor adapter.
4. Prefer the build plugin as the primary path:

```ts
// Vite
import { federationDoctor } from "@module-federation/doctor/vite";
federationDoctor({ moduleFederation: mfOptions });

// Rspack
import { moduleFederationDoctorPlugin } from "@module-federation/doctor/rspack";
moduleFederationDoctorPlugin({ moduleFederation: mfOptions });

// Rsbuild
import { pluginModuleFederationDoctor } from "@module-federation/doctor/rsbuild";
pluginModuleFederationDoctor({ moduleFederation: mfOptions });
```

5. Or run the smallest useful CLI check:

```bash
pnpm mfdoctor check --format terminal,json,sarif
pnpm mfdoctor runtime ./.mf/observability/latest.json
```

6. For build facts, run the real bundler build with the Doctor adapter.
   `CI=true` (or `mode: "ci"`) fails the build on error findings after collect.
7. For a multi-app system, collect every `.mf/doctor/project.json` and run:

```bash
pnpm mfdoctor federation ".mf/doctor/**/project.json"
```

8. When the user asks for a deployed check, use the guarded probe:

```bash
pnpm mfdoctor probe https://cdn.example.com/mf-manifest.json --remote-entry
```

9. Read findings by category: correctness, reliability, performance, security,
   then tooling.
10. For each finding, report the evidence, impact, exact fix, and official source.
11. Rerun the same command after the fix.

## Guardrails

- Keep default analysis offline. Fetch live remotes only when the user asks for
  a network probe.
- Never include source bodies, tokens, cookies, or full private URLs in reports.
- Distinguish Core/Rspack/Rsbuild options from Vite-only options.
- Treat an emitted manifest as release evidence only after a clean build.
- Do not recommend `manualChunks` or custom code-splitting groups for the Vite
  federation runtime graph.
- Do not recommend `provideExternalRuntime` on a producer.
- Do not call `server-calc` tree shaking complete unless deployment merged every
  consumer's exports, published the secondary artifact, and updated snapshots.
- Use runtime error codes and official observability reports for live failures.
  Do not claim static analysis observed browser runtime behavior.

## References

- Read [references/sources.md](references/sources.md) before changing a rule or
  making an upstream behavior claim.
- Read [references/reports.md](references/reports.md) when consuming Doctor
  JSON or SARIF output.
- Read the repository Rspress pages under `apps/docs/docs` for the current rule
  and fix catalog.
