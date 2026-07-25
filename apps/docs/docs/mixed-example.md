# Mixed federation example

The repository example uses a Vite host on 5173, a direct Rspack remote on 3001,
and an Rsbuild remote on 3002. Both remotes expose visible React components and
share React as a singleton. Each app registers the Doctor plugin next to Module
Federation (`federationDoctor`, `moduleFederationDoctorPlugin`,
`pluginModuleFederationDoctor`, or `ModuleFederationDoctorPlugin`). Playwright
proves both remotes render without console errors.

This path stays clean on purpose so e2e and adapter dogfood stay green. The Vite
host intentionally turns off `config/remote-manifest-recommended` and
`reliability/version-first-offline-remotes` with comments — that is the
canonical suppression pattern for accepted host choices (see
[Suppressions and allowlists](./suppressions.md)).

For intentional Doctor findings:

- [Finding showcase](./showcase.md) — themed one-rule demos
- [Mixed federation issues](./mixed-issues-example.md) — same multi-bundler shape, red on purpose
