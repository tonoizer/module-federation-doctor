# Rule reference

Rule pages are generated from package metadata. Each page explains the issue, impact, fix, and upstream evidence.

Browse by folder in the sidebar: Config, Shared, Artifact, Bridge, SSR, Reliability, Runtime, Runtime plugins, Federation, Performance, Vite, Security, and Doctor. Printed terminal `docs:` links open the same pages.

## Correctness

| Rule | Severity | What it protects |
| --- | --- | --- |
| [`artifact/expose-missing`](./artifact/expose-missing.md) | error | The config promises an expose that the emitted manifest does not contain. |
| [`artifact/manifest-invalid`](./artifact/manifest-invalid.md) | error | The runtime and tooling cannot consume malformed or incomplete manifest JSON. |
| [`artifact/manifest-name-mismatch`](./artifact/manifest-name-mismatch.md) | error | Stale output can register a different container than the current config. |
| [`artifact/manifest-remote-entry-missing`](./artifact/manifest-remote-entry-missing.md) | error | Consumers follow manifest metadata to a remote entry that was not emitted. |
| [`artifact/public-path-non-string-manifest`](./artifact/public-path-non-string-manifest.md) | warning | Module Federation skips manifest generation when bundler `output.publicPath` is not a string. |
| [`artifact/public-path-suspicious`](./artifact/public-path-suspicious.md) | warning | A malformed asset base makes remote chunks and styles resolve from the wrong URL. |
| [`artifact/remote-entry-missing`](./artifact/remote-entry-missing.md) | error | A producer has no executable container at its configured filename. |
| [`bridge/lazy-plugin-unregistered`](./bridge/lazy-plugin-unregistered.md) | error | Lazy Bridge React loading requires `@module-federation/bridge-react/plugin` in `runtimePlugins` or Bridge remotes fail at runtime. |
| [`bridge/provider-shape-invalid`](./bridge/provider-shape-invalid.md) | error | Incomplete `createRemoteAppComponent` / `createBridgeComponent` options omit required loader/module or root component contracts and break Bridge remotes. |
| [`bridge/react-dom-prefix-missing`](./bridge/react-dom-prefix-missing.md) | error | Bridge React v18/v19 needs `react-dom/` (or `react-dom/client`) in `shared` so renderer subpaths negotiate one copy across host and remote. |
| [`bridge/react-version-entry-mismatch`](./bridge/react-version-entry-mismatch.md) | error | Importing `@module-federation/bridge-react/v18` against React 19 (or the reverse) selects the wrong Bridge API surface and can fail at runtime. |
| [`bridge/router-shared-conflict`](./bridge/router-shared-conflict.md) | error | Bridge router aliases React Router; sharing `react-router` / `react-router-dom` at the same time can load duplicate router runtimes and break navigation. |
| [`bridge/ssr-server-entry-leak`](./bridge/ssr-server-entry-leak.md) | error | Browser-only Bridge React entries must not load inside node/SSR builds; doing so leaks DOM-oriented Bridge code into the server bundle. |
| [`bridge/vue-share-missing`](./bridge/vue-share-missing.md) | error | Vue Bridge remotes and hosts that omit `vue` (and `vue-router` when used) from `shared` can load duplicate Vue runtimes and break reactivity or routing. |
| [`config/duplicate-plugin-registration`](./config/duplicate-plugin-registration.md) | error | Registering Module Federation more than once on the same compiler breaks the core singleton contract. |
| [`config/eager-tree-shaking-conflict`](./config/eager-tree-shaking-conflict.md) | error | Eager modules live in the initial entry and cannot use the on-demand shared tree-shaking path. |
| [`config/expose-key-invalid`](./config/expose-key-invalid.md) | error | Consumers cannot address an expose whose public key does not follow the `./Name` form. |
| [`config/expose-path-missing`](./config/expose-path-missing.md) | error | The producer build cannot include a module that does not exist at the configured path. |
| [`config/external-runtime-conflict`](./config/external-runtime-conflict.md) | error | The same build cannot externalize the runtime it is responsible for providing. |
| [`config/external-runtime-with-exposes`](./config/external-runtime-with-exposes.md) | error | A runtime provider is only supported on a pure consumer and the upstream plugin throws otherwise. |
| [`config/get-public-path-invalid`](./config/get-public-path-invalid.md) | error | The runtime cannot evaluate an invalid stringified public-path function. |
| [`config/library-remote-type-mismatch`](./config/library-remote-type-mismatch.md) | warning | A consumer loader can fail when its remote type does not match the producer library format. |
| [`config/name-required`](./config/name-required.md) | error | The runtime uses the container name for global state and module lookup. Official plugins also reject a missing name at startup, so Doctor keeps this for offline checks rather than a showcase fixture. |
| [`config/plugin-package-mismatch`](./config/plugin-package-mismatch.md) | warning | Using the wrong integration can skip required bundler hooks and runtime generation. |
| [`config/remote-alias-prefix-collision`](./config/remote-alias-prefix-collision.md) | error | An alias that prefixes another remote name/alias makes multi-level path references ambiguous and is rejected by the runtime. |
| [`config/remote-capability-disabled`](./config/remote-capability-disabled.md) | error | Tree-shaken remote-consumption code cannot load configured remotes. |
| [`config/remote-entry-invalid`](./config/remote-entry-invalid.md) | error | The runtime cannot resolve a remote without a usable entry or manifest address. |
| [`config/runtime-plugin-missing`](./config/runtime-plugin-missing.md) | error | A missing runtime plugin stops injected runtime behavior from loading. |
| [`config/share-scope-undeclared`](./config/share-scope-undeclared.md) | error | A dependency placed in a scope the container does not initialize cannot be reused there. |
| [`config/shared-capability-disabled`](./config/shared-capability-disabled.md) | error | Tree-shaken sharing code cannot register or consume configured shared packages. |
| [`config/transform-import-share-conflict`](./config/transform-import-share-conflict.md) | warning | transformImport (or equivalent) can rewrite packages that are also shared, bypassing or duplicating the share scope. |
| [`config/tree-shaking-server-calc-injection`](./config/tree-shaking-server-calc-injection.md) | warning | Runtime-injected used exports conflict with the deployment-owned `server-calc` contract. |
| [`federation/external-runtime-provider-missing`](./federation/external-runtime-provider-missing.md) | error | External-runtime remotes cannot start without a federation-wide provider. |
| [`federation/name-conflict`](./federation/name-conflict.md) | error | Duplicate container names collide in runtime data and global chunk storage. |
| [`federation/share-scope-mismatch`](./federation/share-scope-mismatch.md) | error | Projects in different scopes cannot reuse the same shared provider. |
| [`federation/version-conflict`](./federation/version-conflict.md) | error | No installed provider version satisfies every consumer range. |
| [`runtime-plugins/invalid-factory`](./runtime-plugins/invalid-factory.md) | warning | A runtime plugin without a factory or usable `name` is ignored at runtime (silent no-op). |
| [`shared/react-host-missing`](./shared/react-host-missing.md) | warning | A React host that loads remotes without sharing its imported React runtime can create separate React or renderer instances across the federation graph. |
| [`shared/version-unsatisfied`](./shared/version-unsatisfied.md) | error | The installed provider does not satisfy the configured consumer range. |
| [`ssr/node-remote-manifest`](./ssr/node-remote-manifest.md) | error | Node/SSR consumers that load the browser `mf-manifest.json` miss the server remote graph and can fail to resolve remotes during SSR. |
| [`ssr/node-runtime-plugin-missing`](./ssr/node-runtime-plugin-missing.md) | error | Without `@module-federation/node/runtimePlugin`, Node Federation hosts cannot load remotes with the server runtime contract. |
| [`vite/alias-share-bypass`](./vite/alias-share-bypass.md) | warning | resolve.alias can rewrite imports around the share scope and duplicate singleton packages. |
| [`vite/host-init-inject-ssr`](./vite/host-init-inject-ssr.md) | error | SSR and HTML-less frameworks need host init injected into the entry, not the HTML document, or federation bootstrap never runs on the server. |
| [`vite/remotes-prefer-module`](./vite/remotes-prefer-module.md) | warning | Vite string remotes and missing/`var` type default to script-style loading. Vite↔Vite ESM remotes need explicit `type: 'module'`; mixed bundlers should declare an explicit non-default type (for example `global`) or document a `varFilename` producer interop path. |

## Reliability

| Rule | Severity | What it protects |
| --- | --- | --- |
| [`artifact/dts-disabled`](./artifact/dts-disabled.md) | warning | Consumers receive no automatic contract for exposed TypeScript modules. |
| [`artifact/manifest-assets-disabled`](./artifact/manifest-assets-disabled.md) | warning | Disabled asset analysis removes shared and expose asset details from producer metadata. |
| [`artifact/manifest-expose-assets-empty`](./artifact/manifest-expose-assets-empty.md) | warning | Preload and debugging tools cannot map an expose to its assets. |
| [`artifact/manifest-shared-version-mismatch`](./artifact/manifest-shared-version-mismatch.md) | warning | Stale version metadata can choose the wrong shared provider at runtime. |
| [`bridge/consumer-api-manual`](./bridge/consumer-api-manual.md) | warning | Hand-rolled `loadRemote` / remote mounts skip Bridge lifecycle helpers and lose documented loading/error contracts. |
| [`bridge/export-app-missing`](./bridge/export-app-missing.md) | warning | Bridge producers without `./export-app` break the conventional Bridge remote contract expected by hosts. |
| [`bridge/missing-fallback-loading`](./bridge/missing-fallback-loading.md) | warning | Bridge remotes without `fallback`/`loading` leave consumers with a blank screen while the remote loads or fails. |
| [`bridge/react-version-entry-prefer`](./bridge/react-version-entry-prefer.md) | warning | The bare `@module-federation/bridge-react` entry can pick the wrong React Bridge API when the React major is known. |
| [`bridge/vue-consumer-manual`](./bridge/vue-consumer-manual.md) | warning | Hand-rolled `loadRemote` mounts skip Vue Bridge lifecycle helpers and documented loading/error contracts. |
| [`bridge/vue-server-entry`](./bridge/vue-server-entry.md) | warning | Browser-only Vue Bridge entries in node/SSR builds miss the server/hydration contract and can leak client-only Bridge code. |
| [`bridge/vue-ssr-fresh-context`](./bridge/vue-ssr-fresh-context.md) | warning | Reusing one Vue app/router/store across SSR requests leaks request state between users. |
| [`config/dts-output-dir-mismatch`](./config/dts-output-dir-mismatch.md) | warning | A nested remote-entry `filename` that disagrees with `dts.generateTypes.outputDir` can publish type archives to the wrong path. |
| [`config/implementation-suspicious`](./config/implementation-suspicious.md) | info | A custom implementation can violate the runtime contract expected by the build plugin. |
| [`config/nested-producer-dts-extract`](./config/nested-producer-dts-extract.md) | warning | A producer can omit remote types only when an exposed module actually re-exports a configured remote and the remote types are not extracted. |
| [`config/remote-localhost-in-production`](./config/remote-localhost-in-production.md) | warning | Localhost remotes in CI/production builds cannot resolve on other machines and break deployments. |
| [`federation/circular-remote-graph`](./federation/circular-remote-graph.md) | warning | A remote cycle is valid Module Federation topology by itself. Doctor warns only when a strongly connected group contains a `version-first` member that eagerly loads a remote during startup. |
| [`federation/missing-provider`](./federation/missing-provider.md) | error | Every consumer disabled its fallback, so no build can provide the package. |
| [`federation/share-strategy-mismatch`](./federation/share-strategy-mismatch.md) | warning | Hosts and remotes that disagree on `version-first` vs `loaded-first` negotiate shared versions differently at startup. |
| [`reliability/async-startup-library-promise`](./reliability/async-startup-library-promise.md) | warning | Async startup changes synchronous library entry exports into a Promise contract. |
| [`reliability/external-runtime-provider-unverified`](./reliability/external-runtime-provider-unverified.md) | warning | A remote fails if `_FEDERATION_RUNTIME_CORE` is absent or initialized too late. |
| [`reliability/shared-import-false`](./reliability/shared-import-false.md) | warning | With `import: false`, no local fallback exists if another provider is missing. |
| [`reliability/snapshot-capability-disabled`](./reliability/snapshot-capability-disabled.md) | warning | Snapshot removal disables manifest remotes, preload, dynamic type hints, HMR, and DevTools data. |
| [`reliability/tree-shaking-server-calc-contract`](./reliability/tree-shaking-server-calc-contract.md) | warning | Server-calculated shared artifacts need a known fallback output and deployment pipeline. |
| [`reliability/version-first-offline-remotes`](./reliability/version-first-offline-remotes.md) | warning | An unavailable remote can break startup before its exposed module is requested. |
| [`reliability/vite-fixed-parse-timeout`](./reliability/vite-fixed-parse-timeout.md) | info | A busy large build can exceed a fixed timeout and produce incomplete remote/shared analysis. |
| [`runtime-plugins/create-script-cors-parity`](./runtime-plugins/create-script-cors-parity.md) | warning | CORS on createScript without matching createLink makes preload and load use different cache keys. |
| [`runtime-plugins/create-script-without-link`](./runtime-plugins/create-script-without-link.md) | info | A createScript hook without createLink can waste preload work when link-based loading is used. |
| [`runtime/error-correlated`](./runtime/error-correlated.md) | error | A stable RUNTIME error code from an imported browser trace was matched to offline build evidence. |
| [`runtime/init-failed`](./runtime/init-failed.md) | error | Container initialization failed before exposes or shared resolution could finish. |
| [`runtime/remote-load-failed`](./runtime/remote-load-failed.md) | error | A browser Observability trace failed while loading a remote manifest, entry, expose, or factory. |
| [`runtime/shared-mismatch`](./runtime/shared-mismatch.md) | error | Runtime shared selection conflicts with installed versions, required ranges, or provider config. |
| [`shared/singleton-mismatch`](./shared/singleton-mismatch.md) | warning | Projects disagree on whether multiple instances are allowed. |
| [`shared/singleton-risk`](./shared/singleton-risk.md) | warning | Multiple framework runtimes can split global state, contexts, hooks, or renderers. |
| [`ssr/node-library-dts`](./ssr/node-library-dts.md) | warning | Node/SSR producers that keep ESM-style `library.type` or enabled `dts` diverge from the commonjs dual-env contract used by server remotes. |
| [`vite/hashed-remote-filename`](./vite/hashed-remote-filename.md) | warning | Hashed remote entry filenames invalidate consumer URLs whenever the producer rebuilds. |
| [`vite/manual-chunks-conflict`](./vite/manual-chunks-conflict.md) | warning | Custom manualChunks / codeSplitting.groups can fight federation bootstrap chunk ownership and create init-order cycles. |
| [`vite/server-origin`](./vite/server-origin.md) | warning | Without `server.origin`, remote consumers may resolve assets against the wrong public origin in development. |
| [`vite/ssr-nitro-externals`](./vite/ssr-nitro-externals.md) | warning | Shared React (or react-dom) can conflict with Nitro/SSR externals and `ssrEntryLoader` when the server expects a different module instance. |

## Performance

| Rule | Severity | What it protects |
| --- | --- | --- |
| [`federation/ghost-shares`](./federation/ghost-shares.md) | info | A package is declared in `shared` by only one project and is unused elsewhere in the federation graph, creating one-sided version coupling. |
| [`federation/host-gaps`](./federation/host-gaps.md) | warning | A package used by two or more federation projects is missing from every `shared` config, so each app may bundle its own copy. |
| [`performance/asset-budget`](./performance/asset-budget.md) | warning | Federation assets that exceed project budgets slow startup and transfer more bytes than planned. |
| [`performance/version-first-startup`](./performance/version-first-startup.md) | info | `version-first` loads all remote entries during initialization, adding startup work. |
| [`performance/vite-bundle-all-css`](./performance/vite-bundle-all-css.md) | warning | Vite attaches all bundle CSS to every expose, which can duplicate transfer and style work. |
| [`shared/candidate`](./shared/candidate.md) | info | A stateful framework dependency may be bundled separately by host and remote. |
| [`shared/deep-import-bypass`](./shared/deep-import-bypass.md) | warning | Subpath imports bypass Module Federation shared-scope negotiation when only the root package is declared in `shared`, so each microfrontend may bundle its own copy. |
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
| [`bridge/disable-alias-deprecated`](./bridge/disable-alias-deprecated.md) | info | `bridge.disableAlias` is a deprecated escape hatch; explicit `enableBridgeRouter` communicates intent clearly. |
| [`bridge/router-implicit-enable`](./bridge/router-implicit-enable.md) | info | Rspack may auto-enable Bridge router when the Bridge package is present; leaving `bridge.enableBridgeRouter` implicit hides the routing contract from reviewers and CI. |
| [`bridge/ssr-instanceid-hydration`](./bridge/ssr-instanceid-hydration.md) | info | Without a stable `bridge.instanceId`, SSR Bridge hydration registries can collide across requests. |
| [`bridge/tanstack-router-conflict`](./bridge/tanstack-router-conflict.md) | info | Bridge router aliasing plus `@tanstack/react-router` can duplicate navigation ownership in one app. |
| [`config/get-public-path-unused`](./config/get-public-path-unused.md) | info | `getPublicPath` has no effect on a consumer that exposes no modules. |
| [`config/remote-manifest-recommended`](./config/remote-manifest-recommended.md) | info | A direct remote entry lacks manifest-powered type hints, preloading data, and richer DevTools data. |
| [`config/remote-type-urls-missing`](./config/remote-type-urls-missing.md) | warning | Doctor reports this only when it can prove that a direct remote entry's inferred type location cannot match known producer output. Normal `remoteEntry.js` entries infer `@mf-types.zip` by default. |
| [`doctor/partial-analysis`](./doctor/partial-analysis.md) | warning | Missing facts or unresolved dynamic imports reduce confidence and can hide relevant findings. |
| [`runtime/remote-unknown`](./runtime/remote-unknown.md) | warning | The trace names a remote that is absent from loaded Doctor project facts. |
| [`vite/remote-hmr-dev`](./vite/remote-hmr-dev.md) | info | Without `remoteHmr`, local Vite remotes miss cross-container hot updates. |
| [`vite/var-filename-interop`](./vite/var-filename-interop.md) | info | `varFilename` emits an additional global-format remote entry so var hosts (webpack/rspack) can load this Vite producer. |
