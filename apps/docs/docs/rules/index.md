# Rule reference

Rule pages are generated from package metadata. Each page explains the issue, impact, fix, and upstream evidence.

## Correctness

| Rule | Severity | What it protects |
| --- | --- | --- |
| [`artifact/expose-missing`](./artifact/expose-missing.md) | error | The config promises an expose that the emitted manifest does not contain. |
| [`artifact/manifest-invalid`](./artifact/manifest-invalid.md) | error | The runtime and tooling cannot consume malformed or incomplete manifest JSON. |
| [`artifact/manifest-name-mismatch`](./artifact/manifest-name-mismatch.md) | error | Stale output can register a different container than the current config. |
| [`artifact/manifest-remote-entry-missing`](./artifact/manifest-remote-entry-missing.md) | error | Consumers follow manifest metadata to a remote entry that was not emitted. |
| [`artifact/public-path-suspicious`](./artifact/public-path-suspicious.md) | warning | A malformed asset base makes remote chunks and styles resolve from the wrong URL. |
| [`artifact/remote-entry-missing`](./artifact/remote-entry-missing.md) | error | A producer has no executable container at its configured filename. |
| [`config/eager-tree-shaking-conflict`](./config/eager-tree-shaking-conflict.md) | error | Eager modules live in the initial entry and cannot use the on-demand shared tree-shaking path. |
| [`config/expose-key-invalid`](./config/expose-key-invalid.md) | error | Consumers cannot address an expose whose public key does not follow the `./Name` form. |
| [`config/expose-path-missing`](./config/expose-path-missing.md) | error | The producer build cannot include a module that does not exist at the configured path. |
| [`config/external-runtime-conflict`](./config/external-runtime-conflict.md) | error | The same build cannot externalize the runtime it is responsible for providing. |
| [`config/external-runtime-with-exposes`](./config/external-runtime-with-exposes.md) | error | A runtime provider is only supported on a pure consumer and the upstream plugin throws otherwise. |
| [`config/get-public-path-invalid`](./config/get-public-path-invalid.md) | error | The runtime cannot evaluate an invalid stringified public-path function. |
| [`config/library-remote-type-mismatch`](./config/library-remote-type-mismatch.md) | warning | A consumer loader can fail when its remote type does not match the producer library format. |
| [`config/name-required`](./config/name-required.md) | error | The runtime uses the container name for global state and module lookup. |
| [`config/plugin-package-mismatch`](./config/plugin-package-mismatch.md) | warning | Using the wrong integration can skip required bundler hooks and runtime generation. |
| [`config/remote-capability-disabled`](./config/remote-capability-disabled.md) | error | Tree-shaken remote-consumption code cannot load configured remotes. |
| [`config/remote-entry-invalid`](./config/remote-entry-invalid.md) | error | The runtime cannot resolve a remote without a usable entry or manifest address. |
| [`config/runtime-plugin-missing`](./config/runtime-plugin-missing.md) | error | A missing runtime plugin stops injected runtime behavior from loading. |
| [`config/share-scope-undeclared`](./config/share-scope-undeclared.md) | error | A dependency placed in a scope the container does not initialize cannot be reused there. |
| [`config/shared-capability-disabled`](./config/shared-capability-disabled.md) | error | Tree-shaken sharing code cannot register or consume configured shared packages. |
| [`config/shared-externals-conflict`](./config/shared-externals-conflict.md) | error | A dependency cannot be provided by federation after the bundler removes it as an external. |
| [`config/tree-shaking-server-calc-injection`](./config/tree-shaking-server-calc-injection.md) | warning | Runtime-injected used exports conflict with the deployment-owned `server-calc` contract. |
| [`federation/external-runtime-provider-missing`](./federation/external-runtime-provider-missing.md) | error | External-runtime remotes cannot start without a federation-wide provider. |
| [`federation/name-conflict`](./federation/name-conflict.md) | error | Duplicate container names collide in runtime data and global chunk storage. |
| [`federation/share-scope-mismatch`](./federation/share-scope-mismatch.md) | error | Projects in different scopes cannot reuse the same shared provider. |
| [`federation/version-conflict`](./federation/version-conflict.md) | error | No installed provider version satisfies every consumer range. |
| [`shared/version-unsatisfied`](./shared/version-unsatisfied.md) | error | The installed provider does not satisfy the configured consumer range. |

## Reliability

| Rule | Severity | What it protects |
| --- | --- | --- |
| [`artifact/dts-disabled`](./artifact/dts-disabled.md) | warning | Consumers receive no automatic contract for exposed TypeScript modules. |
| [`artifact/manifest-assets-disabled`](./artifact/manifest-assets-disabled.md) | warning | Disabled asset analysis removes shared and expose asset details from producer metadata. |
| [`artifact/manifest-expose-assets-empty`](./artifact/manifest-expose-assets-empty.md) | warning | Preload and debugging tools cannot map an expose to its assets. |
| [`artifact/manifest-shared-version-mismatch`](./artifact/manifest-shared-version-mismatch.md) | warning | Stale version metadata can choose the wrong shared provider at runtime. |
| [`config/implementation-suspicious`](./config/implementation-suspicious.md) | warning | A custom implementation can violate the runtime contract expected by the build plugin. |
| [`federation/missing-provider`](./federation/missing-provider.md) | error | Every consumer disabled its fallback, so no build can provide the package. |
| [`reliability/async-startup-library-promise`](./reliability/async-startup-library-promise.md) | warning | Async startup changes synchronous library entry exports into a Promise contract. |
| [`reliability/external-runtime-provider-unverified`](./reliability/external-runtime-provider-unverified.md) | warning | A remote fails if `_FEDERATION_RUNTIME_CORE` is absent or initialized too late. |
| [`reliability/shared-import-false`](./reliability/shared-import-false.md) | warning | With `import: false`, no local fallback exists if another provider is missing. |
| [`reliability/snapshot-capability-disabled`](./reliability/snapshot-capability-disabled.md) | warning | Snapshot removal disables manifest remotes, preload, dynamic type hints, HMR, and DevTools data. |
| [`reliability/tree-shaking-server-calc-contract`](./reliability/tree-shaking-server-calc-contract.md) | warning | Server-calculated shared artifacts need a known fallback output and deployment pipeline. |
| [`reliability/version-first-offline-remotes`](./reliability/version-first-offline-remotes.md) | warning | An unavailable remote can break startup before its exposed module is requested. |
| [`reliability/vite-fixed-parse-timeout`](./reliability/vite-fixed-parse-timeout.md) | info | A busy large build can exceed a fixed timeout and produce incomplete remote/shared analysis. |
| [`shared/singleton-mismatch`](./shared/singleton-mismatch.md) | warning | Projects disagree on whether multiple instances are allowed. |
| [`shared/singleton-risk`](./shared/singleton-risk.md) | warning | Multiple framework runtimes can split global state, contexts, hooks, or renderers. |

## Performance

| Rule | Severity | What it protects |
| --- | --- | --- |
| [`performance/asset-budget`](./performance/asset-budget.md) | warning | Federation assets that exceed project budgets slow startup and transfer more bytes than planned. |
| [`performance/version-first-startup`](./performance/version-first-startup.md) | info | `version-first` loads all remote entries during initialization, adding startup work. |
| [`performance/vite-bundle-all-css`](./performance/vite-bundle-all-css.md) | warning | Vite attaches all bundle CSS to every expose, which can duplicate transfer and style work. |
| [`shared/candidate`](./shared/candidate.md) | warning | A stateful framework dependency may be bundled separately by host and remote. |
| [`shared/eager-without-singleton`](./shared/eager-without-singleton.md) | warning | An eager non-singleton can add copies to initial chunks without guaranteeing reuse. |
| [`shared/unused`](./shared/unused.md) | warning | Unused shared declarations add runtime bookkeeping and can signal stale config. |

## Security

| Rule | Severity | What it protects |
| --- | --- | --- |
| [`config/filename-invalid`](./config/filename-invalid.md) | error | Unsafe paths can escape output layout; a non-JavaScript entry cannot run as a container. |
| [`config/remote-http-insecure`](./config/remote-http-insecure.md) | warning | Remote code fetched over plain HTTP can be changed in transit. |
| [`security/get-public-path-dynamic-code`](./security/get-public-path-dynamic-code.md) | warning | Module Federation evaluates this string with `new Function` in the consumer. |

## Tooling

| Rule | Severity | What it protects |
| --- | --- | --- |
| [`artifact/manifest-disabled`](./artifact/manifest-disabled.md) | info | Without manifests, consumers lose metadata-powered preloading, type hints, and richer inspection. |
| [`artifact/types-metadata-missing`](./artifact/types-metadata-missing.md) | warning | The manifest cannot advertise generated type archives to consumers. |
| [`artifact/types-missing`](./artifact/types-missing.md) | warning | No emitted declaration artifact was found for a typed producer. |
| [`config/get-public-path-unused`](./config/get-public-path-unused.md) | info | `getPublicPath` has no effect on a consumer that exposes no modules. |
| [`config/remote-manifest-recommended`](./config/remote-manifest-recommended.md) | info | A direct remote entry lacks manifest-powered type hints, preloading data, and richer DevTools data. |
| [`doctor/partial-analysis`](./doctor/partial-analysis.md) | warning | Missing facts reduce confidence and can hide relevant findings. |
