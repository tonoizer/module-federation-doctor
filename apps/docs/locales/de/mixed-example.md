<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Mixed federation example

The repository example uses a Vite host on 5173, a direct Rspack remote on 3001,
and an Rsbuild remote on 3002. Both remotes expose visible React components and
share React as a singleton. Each app registers the MFDoctor plugin next to Module
Federation (`federationDoctor`, `moduleFederationDoctorPlugin`,
`pluginModuleFederationDoctor`, or `ModuleFederationDoctorPlugin`). Playwright
proves both remotes render without console errors.

This path stays clean on purpose so e2e and adapter dogfood stay green. The Vite
host intentionally turns off `config/remote-manifest-recommended` and
`reliability/version-first-offline-remotes` with comments — that is the
canonical suppression pattern for accepted host choices (see
[Suppressions and allowlists](./suppressions.md)).

For nested multi-bundler orchestration (Vite → Vite/Rsbuild → Rspack/Webpack),
see [Nested federation example](./nested-example.md).

For intentional MFDoctor findings:

- [Examples overview](./examples.md) — full catalog
- [One-rule showcase](./showcase.md) — CLI one-rule fixtures
- [Standalone findings](./standalone-findings.md) — per-bundler build+MFDoctor demos
- [Mixed federation issues](./mixed-issues-example.md) — same multi-bundler shape, red on purpose
