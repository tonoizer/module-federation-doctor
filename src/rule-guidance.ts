export type RuleCategory = "correctness" | "performance" | "reliability" | "security" | "tooling";

export interface RuleGuidance {
  category: RuleCategory;
  impact: string;
  fix: string;
  sources: string[];
}

const configure = "https://module-federation.io/configure/index.html";
const manifest = "https://module-federation.io/configure/manifest.html";
const shared = "https://module-federation.io/configure/shared.html";
const runtimePlugins = "https://module-federation.io/configure/runtimeplugins.html";
const experiments = "https://module-federation.io/configure/experiments.html";
const vite = "https://github.com/module-federation/vite";
const core = "https://github.com/module-federation/core";

export const ruleGuidance: Record<string, RuleGuidance> = {
  "config/name-required": {
    category: "correctness",
    impact:
      "The runtime uses the container name for global state and module lookup. Official plugins also reject a missing name at startup, so Doctor keeps this for offline checks rather than a showcase fixture.",
    fix: 'Set `name` to a stable, federation-wide unique id such as "host" or "shop".',
    sources: ["https://module-federation.io/configure/name.html"],
  },
  "config/expose-key-invalid": {
    category: "correctness",
    impact:
      "Consumers cannot address an expose whose public key does not follow the `./Name` form.",
    fix: "Rename the key to start with `./` and update consumer imports.",
    sources: ["https://module-federation.io/configure/exposes.html"],
  },
  "config/expose-path-missing": {
    category: "correctness",
    impact:
      "The producer build cannot include a module that does not exist at the configured path.",
    fix: "Correct the path, including its exact extension, or create the source file.",
    sources: ["https://module-federation.io/configure/exposes.html"],
  },
  "config/remote-entry-invalid": {
    category: "correctness",
    impact: "The runtime cannot resolve a remote without a usable entry or manifest address.",
    fix: "Use a valid URL/object entry or the `name@url` form supported by the bundler.",
    sources: ["https://module-federation.io/configure/remotes.html"],
  },
  "config/filename-invalid": {
    category: "security",
    impact:
      "Unsafe paths can escape output layout; a non-JavaScript entry cannot run as a container.",
    fix: "Use a relative `.js` or `.mjs` filename without absolute or `..` segments.",
    sources: ["https://module-federation.io/configure/filename.html"],
  },
  "config/remote-http-insecure": {
    category: "security",
    impact: "Remote code fetched over plain HTTP can be changed in transit.",
    fix: "Serve non-local remotes over HTTPS and keep HTTP only for local development.",
    sources: ["https://module-federation.io/configure/remotes.html"],
  },
  "config/remote-localhost-in-production": {
    category: "reliability",
    impact:
      "Localhost remotes in CI/production builds cannot resolve on other machines and break deployments.",
    fix: "Point remotes at deployed HTTPS (or manifest) URLs for CI and production builds.",
    sources: ["https://module-federation.io/configure/remotes.html"],
  },
  "config/duplicate-plugin-registration": {
    category: "correctness",
    impact:
      "Registering Module Federation more than once on the same compiler breaks the core singleton contract.",
    fix: "Keep a single Module Federation plugin instance per compiler.",
    sources: [core, "https://module-federation.io/guide/installation.html"],
  },
  "config/remote-alias-prefix-collision": {
    category: "correctness",
    impact:
      "An alias that prefixes another remote name/alias makes multi-level path references ambiguous and is rejected by the runtime.",
    fix: "Rename aliases so none is a prefix of another remote name or alias.",
    sources: ["https://module-federation.io/configure/remotes.html", core],
  },
  "config/nested-producer-dts-extract": {
    category: "reliability",
    impact:
      "A producer can omit remote types only when an exposed module actually re-exports a configured remote and the remote types are not extracted.",
    fix: "Enable `dts.generateTypes.extractRemoteTypes` when an exposed module reaches a remote through a local import or re-export.",
    sources: ["https://module-federation.io/configure/dts.html"],
  },
  "config/dts-output-dir-mismatch": {
    category: "reliability",
    impact:
      "A nested remote-entry `filename` that disagrees with `dts.generateTypes.outputDir` can publish type archives to the wrong path.",
    fix: "Align `filename` directory layout with `dts.generateTypes.outputDir`, or keep both at the output root.",
    sources: [
      "https://module-federation.io/configure/dts.html",
      "https://module-federation.io/configure/filename.html",
    ],
  },
  "config/remote-type-urls-missing": {
    category: "tooling",
    impact:
      "Doctor reports this only when it can prove that a direct remote entry's inferred type location cannot match known producer output. Normal `remoteEntry.js` entries infer `@mf-types.zip` by default.",
    fix: "Keep the default inferred type location when producer output follows Module Federation defaults. Use `dts.consumeTypes.remoteTypeUrls` only for runtime-only or custom type locations.",
    sources: [
      "https://module-federation.io/configure/dts.html",
      "https://module-federation.io/configure/remotes.html",
    ],
  },
  "artifact/public-path-non-string-manifest": {
    category: "correctness",
    impact:
      "Module Federation skips manifest generation when bundler `output.publicPath` is not a string.",
    fix: "Set `output.publicPath` to a string URL, root-relative path, or `auto` when manifests are required.",
    sources: [manifest, core],
  },
  "config/remote-manifest-recommended": {
    category: "tooling",
    impact:
      "A direct remote entry lacks manifest-powered type hints, preloading data, and richer DevTools data.",
    fix: "Point consumers at `mf-manifest.json` when those capabilities are wanted.",
    sources: ["https://module-federation.io/configure/remotes.html", manifest],
  },
  "config/library-remote-type-mismatch": {
    category: "correctness",
    impact:
      "A consumer loader can fail when its remote type does not match the producer library format.",
    fix: "Align `library.type`, `remoteType`, and each remote object's `type`.",
    sources: [
      "https://module-federation.io/configure/library.html",
      "https://module-federation.io/configure/remotetype.html",
    ],
  },
  "config/share-scope-undeclared": {
    category: "correctness",
    impact:
      "A dependency placed in a scope the container does not initialize cannot be reused there.",
    fix: "Declare the scope at top level or move the shared item into an initialized scope.",
    sources: ["https://module-federation.io/configure/shareScope.html"],
  },
  "config/runtime-plugin-missing": {
    category: "correctness",
    impact: "A missing runtime plugin stops injected runtime behavior from loading.",
    fix: "Correct the path/package and include local plugin files in the Doctor scan.",
    sources: [runtimePlugins],
  },
  "runtime-plugins/invalid-factory": {
    category: "correctness",
    impact:
      "A runtime plugin without a factory or usable `name` is ignored at runtime (silent no-op).",
    fix: "Export a factory or plugin object that includes a stable `name` plus the hooks you intend to run.",
    sources: [runtimePlugins, "https://module-federation.io/guide/runtime/runtime-plugins.html"],
  },
  "runtime-plugins/create-script-cors-parity": {
    category: "reliability",
    impact:
      "CORS on createScript without matching createLink makes preload and load use different cache keys.",
    fix: "Mirror crossorigin (and credentials where applicable) on createLink; keep fetch credentials consistent.",
    sources: [
      "https://module-federation.io/guide/troubleshooting/runtime.html",
      "https://module-federation.io/guide/runtime/runtime-hooks.html",
    ],
  },
  "runtime-plugins/create-script-without-link": {
    category: "reliability",
    impact:
      "A createScript hook without createLink can waste preload work when link-based loading is used.",
    fix: "Add createLink when preloadRemote or CSS/JS link loading is in play, or suppress if preload is unused.",
    sources: [
      "https://module-federation.io/guide/troubleshooting/runtime.html",
      "https://module-federation.io/guide/runtime/runtime-hooks.html",
    ],
  },
  "config/get-public-path-invalid": {
    category: "correctness",
    impact: "The runtime cannot evaluate an invalid stringified public-path function.",
    fix: "Use a stringified function, arrow function, or return statement.",
    sources: ["https://module-federation.io/configure/getpublicpath.html"],
  },
  "config/get-public-path-unused": {
    category: "tooling",
    impact: "`getPublicPath` has no effect on a consumer that exposes no modules.",
    fix: "Remove dead config or move it to the producer that owns the assets.",
    sources: ["https://module-federation.io/configure/getpublicpath.html"],
  },
  "security/get-public-path-dynamic-code": {
    category: "security",
    impact: "Module Federation evaluates this string with `new Function` in the consumer.",
    fix: "Keep it static, review it as code, and never concatenate untrusted data.",
    sources: ["https://module-federation.io/configure/getpublicpath.html"],
  },
  "config/implementation-suspicious": {
    category: "reliability",
    impact:
      "A custom implementation can violate the runtime contract expected by the build plugin.",
    fix: "Use a compatible `@module-federation/runtime-tools` path and pin compatible versions.",
    sources: ["https://module-federation.io/configure/implementation.html"],
  },
  "config/external-runtime-with-exposes": {
    category: "correctness",
    impact:
      "A runtime provider is only supported on a pure consumer and the upstream plugin throws otherwise.",
    fix: "Move `provideExternalRuntime` to the top consumer or remove exposes.",
    sources: [experiments],
  },
  "config/external-runtime-conflict": {
    category: "correctness",
    impact: "The same build cannot externalize the runtime it is responsible for providing.",
    fix: "Provide at the top consumer and externalize only its browser remotes.",
    sources: [experiments],
  },
  "config/remote-capability-disabled": {
    category: "correctness",
    impact: "Tree-shaken remote-consumption code cannot load configured remotes.",
    fix: "Remove `disableRemote` or remove all consumed remotes.",
    sources: [vite, core],
  },
  "config/shared-capability-disabled": {
    category: "correctness",
    impact: "Tree-shaken sharing code cannot register or consume configured shared packages.",
    fix: "Remove `disableShared` or remove the shared configuration.",
    sources: [vite, core],
  },
  "reliability/snapshot-capability-disabled": {
    category: "reliability",
    impact:
      "Snapshot removal disables manifest remotes, preload, dynamic type hints, HMR, and DevTools data.",
    fix: "Enable snapshots when those features are part of the deployment contract.",
    sources: [vite, core],
  },
  "config/eager-tree-shaking-conflict": {
    category: "correctness",
    impact:
      "Eager modules live in the initial entry and cannot use the on-demand shared tree-shaking path.",
    fix: "Choose eager loading for small dependencies or tree shaking for larger libraries.",
    sources: [shared, vite],
  },
  "reliability/external-runtime-provider-unverified": {
    category: "reliability",
    impact: "A remote fails if `_FEDERATION_RUNTIME_CORE` is absent or initialized too late.",
    fix: "Verify a pure top consumer provides the runtime before remote execution.",
    sources: [experiments],
  },
  "reliability/async-startup-library-promise": {
    category: "reliability",
    impact: "Async startup changes synchronous library entry exports into a Promise contract.",
    fix: "Make consumers await it or keep synchronous startup for that library.",
    sources: [experiments],
  },
  "performance/version-first-startup": {
    category: "performance",
    impact: "`version-first` loads all remote entries during initialization, adding startup work.",
    fix: "Use `loaded-first` when on-demand loading is more important than highest-version selection.",
    sources: ["https://module-federation.io/configure/shareStrategy.html"],
  },
  "performance/asset-budget": {
    category: "performance",
    impact:
      "Federation assets that exceed project budgets slow startup and transfer more bytes than planned.",
    fix: 'Reduce the oversized entry, expose, or shared assets, or raise `rules["performance/asset-budget"]` byte limits.',
    sources: [manifest, "https://module-federation.io/configure/shareStrategy.html"],
  },
  "reliability/version-first-offline-remotes": {
    category: "reliability",
    impact: "An unavailable remote can break startup before its exposed module is requested.",
    fix: "Add `@module-federation/retry-plugin`, an `errorLoadRemote` recovery plugin, or choose `loaded-first` for delayed failure.",
    sources: [
      "https://module-federation.io/configure/shareStrategy.html",
      runtimePlugins,
      "https://github.com/module-federation/core/tree/main/packages/retry-plugin",
    ],
  },
  "federation/share-strategy-mismatch": {
    category: "reliability",
    impact:
      "Hosts and remotes that disagree on `version-first` vs `loaded-first` negotiate shared versions differently at startup.",
    fix: "Pick one federation-wide `shareStrategy`, or document intentional per-app exceptions.",
    sources: ["https://module-federation.io/configure/shareStrategy.html"],
  },
  "federation/circular-remote-graph": {
    category: "reliability",
    impact:
      "A remote cycle is valid Module Federation topology by itself. Doctor warns only when a strongly connected group contains a `version-first` member that eagerly loads a remote during startup.",
    fix: "Keep valid `loaded-first` bi-directional setups. For a risky cycle, use `loaded-first`, add startup fallback handling, or make the remote edge on the startup path lazy.",
    sources: [
      "https://module-federation.io/configure/shareStrategy.html",
      "https://module-federation.io/configure/remotes.html",
      "https://github.com/module-federation/module-federation-examples/tree/master/bi-directional",
    ],
  },
  "reliability/shared-import-false": {
    category: "reliability",
    impact: "With `import: false`, no local fallback exists if another provider is missing.",
    fix: "Guarantee a provider loads first or restore a local fallback.",
    sources: [shared],
  },
  "config/tree-shaking-server-calc-injection": {
    category: "correctness",
    impact:
      "Runtime-injected used exports conflict with the deployment-owned `server-calc` contract.",
    fix: "Disable injection and let the deployment service merge consumer export metadata.",
    sources: ["https://module-federation.io/configure/injectTreeShakingUsedExports.html"],
  },
  "reliability/tree-shaking-server-calc-contract": {
    category: "reliability",
    impact:
      "Server-calculated shared artifacts need a known fallback output and deployment pipeline.",
    fix: "Set `treeShakingDir`, merge all consumer exports, and publish matching secondary artifacts.",
    sources: [
      "https://module-federation.io/configure/treeShakingDir.html",
      "https://module-federation.io/configure/treeShakingSharedPlugins.html",
    ],
  },
  "performance/vite-bundle-all-css": {
    category: "performance",
    impact:
      "Vite attaches all bundle CSS to every expose, which can duplicate transfer and style work.",
    fix: "Disable `bundleAllCSS` unless every expose needs the complete stylesheet set.",
    sources: [vite],
  },
  "reliability/vite-fixed-parse-timeout": {
    category: "reliability",
    impact:
      "A busy large build can exceed a fixed timeout and produce incomplete remote/shared analysis.",
    fix: "Prefer `moduleParseIdleTimeout` so only inactivity ends parsing.",
    sources: [vite],
  },
  "vite/remotes-prefer-module": {
    category: "correctness",
    impact:
      "Vite string remotes and missing/`var` type default to script-style loading. Vite↔Vite ESM remotes need explicit `type: 'module'`; mixed bundlers should declare an explicit non-default type (for example `global`) or document a `varFilename` producer interop path.",
    fix: "Prefer object remotes with `type: 'module'` for Vite↔Vite ESM. For webpack/rspack remotes, set an explicit type such as `global`, or keep `varFilename` when this app intentionally emits a var entry for var hosts.",
    sources: [vite, "https://module-federation.io/configure/remotes.html"],
  },
  "vite/var-filename-interop": {
    category: "tooling",
    impact:
      "`varFilename` emits an additional global-format remote entry so var hosts (webpack/rspack) can load this Vite producer.",
    fix: "Keep `varFilename` when serving webpack/rspack var hosts. Prefer `type: 'module'` remotes when this app is a Vite consumer talking to Vite producers.",
    sources: [vite],
  },
  "vite/host-init-inject-ssr": {
    category: "correctness",
    impact:
      "SSR and HTML-less frameworks need host init injected into the entry, not the HTML document, or federation bootstrap never runs on the server.",
    fix: "Set `hostInitInjectLocation: 'entry'` for SSR / Nitro / Nuxt-style apps.",
    sources: [vite],
  },
  "vite/ssr-nitro-externals": {
    category: "reliability",
    impact:
      "Shared React (or react-dom) can conflict with Nitro/SSR externals and `ssrEntryLoader` when the server expects a different module instance.",
    fix: "Align `shared` React with `ssrExternals` / `ssrEntryLoader` for the SSR runtime, or document an intentional dual-instance path.",
    sources: [vite],
  },
  "vite/manual-chunks-conflict": {
    category: "reliability",
    impact:
      "Custom manualChunks / codeSplitting.groups can fight federation bootstrap chunk ownership and create init-order cycles.",
    fix: "Keep federation runtime chunks isolated; move general splitting outside that graph or allowlist a proven layout.",
    sources: [vite],
  },
  "vite/hashed-remote-filename": {
    category: "reliability",
    impact:
      "Hashed remote entry filenames invalidate consumer URLs whenever the producer rebuilds.",
    fix: "Use a stable `filename` such as `remoteEntry.js` for the container entry.",
    sources: [vite, "https://module-federation.io/configure/filename.html"],
  },
  "vite/remote-hmr-dev": {
    category: "tooling",
    impact: "Without `remoteHmr`, local Vite remotes miss cross-container hot updates.",
    fix: "Enable `remoteHmr` in development profiles when remotes/exposes are active.",
    sources: [vite],
  },
  "vite/alias-share-bypass": {
    category: "correctness",
    impact:
      "resolve.alias can rewrite imports around the share scope and duplicate singleton packages.",
    fix: "Remove the overlapping alias, drop the package from shared, or allowlist intentional bypasses.",
    sources: [vite, shared],
  },
  "vite/server-origin": {
    category: "reliability",
    impact:
      "Without `server.origin`, remote consumers may resolve assets against the wrong public origin in development.",
    fix: "Set Vite `server.origin` to the URL remotes should publish for consumers.",
    sources: [vite],
  },
  "config/transform-import-share-conflict": {
    category: "correctness",
    impact:
      "transformImport (or equivalent) can rewrite packages that are also shared, bypassing or duplicating the share scope.",
    fix: "Remove the rewrite, exclude the package from shared, or allowlist intentional bypasses via `allowPackages`.",
    sources: [
      shared,
      "https://modernjs.dev/guides/basic-features/alias.html",
      "https://rsbuild.rs/config/source/transform-import",
    ],
  },
  "artifact/manifest-assets-disabled": {
    category: "reliability",
    impact:
      "Disabled asset analysis removes shared and expose asset details from producer metadata.",
    fix: "Enable asset analysis for production producer manifests.",
    sources: [manifest, vite],
  },
  "artifact/manifest-disabled": {
    category: "tooling",
    impact:
      "Without manifests, consumers lose metadata-powered preloading, type hints, and richer inspection.",
    fix: "Enable `manifest` where those production and debugging features are needed.",
    sources: [manifest],
  },
  "artifact/dts-disabled": {
    category: "reliability",
    impact: "Consumers receive no automatic contract for exposed TypeScript modules.",
    fix: "Enable DTS generation or document and test another declaration delivery path.",
    sources: ["https://module-federation.io/configure/dts.html"],
  },
  "shared/version-unsatisfied": {
    category: "correctness",
    impact: "The installed provider does not satisfy the configured consumer range.",
    fix: "Align installed versions and `requiredVersion` across the federation.",
    sources: [shared],
  },
  "artifact/manifest-invalid": {
    category: "correctness",
    impact: "The runtime and tooling cannot consume malformed or incomplete manifest JSON.",
    fix: "Rebuild the manifest and verify `metaData`, `exposes`, and `shared` are present.",
    sources: [manifest, core],
  },
  "artifact/manifest-name-mismatch": {
    category: "correctness",
    impact: "Stale output can register a different container than the current config.",
    fix: "Clean output and make the federation plugin and Doctor share one options object.",
    sources: [manifest],
  },
  "artifact/manifest-remote-entry-missing": {
    category: "correctness",
    impact: "Consumers follow manifest metadata to a remote entry that was not emitted.",
    fix: "Clean and rebuild; verify output path, filename, and manifest settings.",
    sources: [manifest],
  },
  "artifact/manifest-expose-assets-empty": {
    category: "reliability",
    impact: "Preload and debugging tools cannot map an expose to its assets.",
    fix: "Ensure the expose is built and manifest asset analysis completes.",
    sources: [manifest],
  },
  "artifact/manifest-shared-version-mismatch": {
    category: "reliability",
    impact: "Stale version metadata can choose the wrong shared provider at runtime.",
    fix: "Clean output, reinstall from the lockfile, and rebuild the manifest.",
    sources: [manifest, shared],
  },
  "artifact/types-metadata-missing": {
    category: "tooling",
    impact: "The manifest cannot advertise generated type archives to consumers.",
    fix: "Fix DTS generation and ensure its metadata reaches the manifest.",
    sources: [manifest, "https://module-federation.io/configure/dts.html"],
  },
  "artifact/remote-entry-missing": {
    category: "correctness",
    impact: "A producer has no executable container at its configured filename.",
    fix: "Check output naming and plugin order, then clean and rebuild.",
    sources: ["https://module-federation.io/configure/filename.html"],
  },
  "artifact/expose-missing": {
    category: "correctness",
    impact: "The config promises an expose that the emitted manifest does not contain.",
    fix: "Fix the expose build or remove the stale public contract.",
    sources: ["https://module-federation.io/configure/exposes.html", manifest],
  },
  "doctor/partial-analysis": {
    category: "tooling",
    impact:
      "Missing facts or unresolved dynamic imports reduce confidence and can hide relevant findings.",
    fix: "When MF options are missing, pass them explicitly. On Vite, missing `mf-manifest.json` / `mf-stats.json` usually means enable `manifest: true` — not missing options. Prefer string-literal dynamic imports or an opt-in runtime trace when analysis is incomplete.",
    sources: [configure],
  },
  "config/plugin-package-mismatch": {
    category: "correctness",
    impact: "Using the wrong integration can skip required bundler hooks and runtime generation.",
    fix: "Use the official package for Vite, Rspack, Rsbuild, Webpack, or Modern.js.",
    sources: ["https://module-federation.io/integrations/index.html"],
  },
  "shared/singleton-risk": {
    category: "reliability",
    impact: "Multiple framework runtimes can split global state, contexts, hooks, or renderers.",
    fix: "Share stateful framework runtimes as singletons and align their versions.",
    sources: [shared],
  },
  "shared/eager-without-singleton": {
    category: "performance",
    impact: "An eager non-singleton can add copies to initial chunks without guaranteeing reuse.",
    fix: "Make it singleton when safe, or remove eager loading.",
    sources: [shared],
  },
  "shared/unused": {
    category: "performance",
    impact: "Unused shared declarations add runtime bookkeeping and can signal stale config.",
    fix: "Remove stale entries, or ensure usage is visible via static imports, string-literal `import()` / `loadShare`, or an opt-in Observability runtime trace.",
    sources: [shared],
  },
  "shared/candidate": {
    category: "performance",
    impact: "A stateful framework dependency may be bundled separately by host and remote.",
    fix: "Evaluate sharing it as a singleton across all participating projects.",
    sources: [shared],
  },
  "shared/deep-import-bypass": {
    category: "performance",
    impact:
      "Subpath imports bypass Module Federation shared-scope negotiation when only the root package is declared in `shared`, so each microfrontend may bundle its own copy.",
    fix: 'Prefer root imports (for example `import { cloneDeep } from "lodash"`), or add the exact subpath keys to `shared`. Suppress intentional cases with `rules["shared/deep-import-bypass"]` or `deepImportAllowlist`.',
    sources: [shared],
  },
  "artifact/public-path-suspicious": {
    category: "correctness",
    impact: "A malformed asset base makes remote chunks and styles resolve from the wrong URL.",
    fix: "Use `auto`, a root-relative path, HTTPS URL, or reviewed dynamic getter.",
    sources: ["https://module-federation.io/configure/getpublicpath.html"],
  },
  "artifact/types-missing": {
    category: "tooling",
    impact: "No emitted declaration artifact was found for a typed producer.",
    fix: "Enable DTS output and fail CI when type generation fails.",
    sources: ["https://module-federation.io/configure/dts.html"],
  },
  "federation/name-conflict": {
    category: "correctness",
    impact: "Duplicate container names collide in runtime data and global chunk storage.",
    fix: "Give every participating container a unique stable name.",
    sources: ["https://module-federation.io/configure/name.html"],
  },
  "federation/version-conflict": {
    category: "correctness",
    impact: "No installed provider version satisfies every consumer range.",
    fix: "Align lockfiles and compatible `requiredVersion` ranges.",
    sources: [shared],
  },
  "federation/share-scope-mismatch": {
    category: "correctness",
    impact: "Projects in different scopes cannot reuse the same shared provider.",
    fix: "Align top-level, remote, and shared-item scopes intentionally.",
    sources: ["https://module-federation.io/configure/shareScope.html"],
  },
  "federation/missing-provider": {
    category: "reliability",
    impact: "Every consumer disabled its fallback, so no build can provide the package.",
    fix: "Let at least one build provide the package or restore a local fallback.",
    sources: [shared],
  },
  "federation/host-gaps": {
    category: "performance",
    impact:
      "A package used by two or more federation projects is missing from every `shared` config, so each app may bundle its own copy.",
    fix: "Add the package to `shared` (usually as a singleton) in every participating project that imports it.",
    sources: [shared],
  },
  "federation/ghost-shares": {
    category: "performance",
    impact:
      "A package is declared in `shared` by only one project and is unused elsewhere in the federation graph, creating one-sided version coupling.",
    fix: "Remove the unused shared entry, or add matching `shared` declarations where other projects actually consume the package.",
    sources: [shared],
  },
  "shared/singleton-mismatch": {
    category: "reliability",
    impact: "Projects disagree on whether multiple instances are allowed.",
    fix: "Use one federation-wide singleton policy for stateful packages.",
    sources: [shared],
  },
  "federation/external-runtime-provider-missing": {
    category: "correctness",
    impact: "External-runtime remotes cannot start without a federation-wide provider.",
    fix: "Enable `provideExternalRuntime` on one top-level pure consumer.",
    sources: [experiments],
  },
  "runtime/remote-load-failed": {
    category: "reliability",
    impact:
      "A browser Observability trace failed while loading a remote manifest, entry, expose, or factory.",
    fix: "Compare the redacted entry URL and manifest metadata with the producer build output.",
    sources: ["https://module-federation.io/plugin/plugins/observability-plugin"],
  },
  "runtime/init-failed": {
    category: "reliability",
    impact: "Container initialization failed before exposes or shared resolution could finish.",
    fix: "Verify async startup, external runtime provider order, and runtime plugins against Doctor project facts.",
    sources: ["https://module-federation.io/plugin/plugins/observability-plugin", experiments],
  },
  "runtime/shared-mismatch": {
    category: "reliability",
    impact:
      "Runtime shared selection conflicts with installed versions, required ranges, or provider config.",
    fix: "Align shared versions, singleton/import settings, and providers across hosts and remotes.",
    sources: ["https://module-federation.io/plugin/plugins/observability-plugin", shared],
  },
  "runtime/remote-unknown": {
    category: "tooling",
    impact: "The trace names a remote that is absent from loaded Doctor project facts.",
    fix: "Collect project.json for every host and remote, or correct the remote name in the trace source.",
    sources: ["https://module-federation.io/plugin/plugins/observability-plugin"],
  },
  "runtime/error-correlated": {
    category: "reliability",
    impact:
      "A stable RUNTIME error code from an imported browser trace was matched to offline build evidence.",
    fix: "Use the RUNTIME code with the matched build facts; do not infer browser behavior from static analysis alone.",
    sources: ["https://module-federation.io/plugin/plugins/observability-plugin"],
  },
  "bridge/react-version-entry-prefer": {
    category: "reliability",
    impact:
      "The bare `@module-federation/bridge-react` entry can pick the wrong React Bridge API when the React major is known.",
    fix: 'Import `@module-federation/bridge-react/v18` or `/v19` to match your React major. Override majors with `reactMajors`, or set the rule to `"off"` when the bare entry is intentional.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "bridge/react-dom-prefix-missing": {
    category: "correctness",
    impact:
      "Bridge React v18/v19 needs `react-dom/` (or `react-dom/client`) in `shared` so renderer subpaths negotiate one copy across host and remote.",
    fix: 'Add `\'react-dom/\': { singleton: true, ... }` (or `react-dom/client`) to `shared`. Disable with `requireReactDomPrefix: false` or `rules["bridge/react-dom-prefix-missing"]: "off"` when intentional.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge", shared],
  },
  "bridge/lazy-plugin-unregistered": {
    category: "correctness",
    impact:
      "Lazy Bridge React loading requires `@module-federation/bridge-react/plugin` in `runtimePlugins` or Bridge remotes fail at runtime.",
    fix: 'Add `@module-federation/bridge-react/plugin` to `runtimePlugins`. Soften with `requireRuntimePlugin: false` or turn the rule `"off"` for non-lazy Bridge setups.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge", runtimePlugins],
  },
  "bridge/router-implicit-enable": {
    category: "tooling",
    impact:
      "Rspack may auto-enable Bridge router when the Bridge package is present; leaving `bridge.enableBridgeRouter` implicit hides the routing contract from reviewers and CI.",
    fix: 'Set `bridge: { enableBridgeRouter: true }` (or `false`) explicitly. Allow demos to stay implicit with `allowImplicitBridgeRouter: true` or set the rule to `"off"`.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "bridge/router-shared-conflict": {
    category: "correctness",
    impact:
      "Bridge router aliases React Router; sharing `react-router` / `react-router-dom` at the same time can load duplicate router runtimes and break navigation.",
    fix: 'Remove React Router from `shared`, or disable Bridge router with `bridge.enableBridgeRouter: false`. Soften with `rules["bridge/router-shared-conflict"]: "off"` when intentional.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge", shared],
  },
  "bridge/react-version-entry-mismatch": {
    category: "correctness",
    impact:
      "Importing `@module-federation/bridge-react/v18` against React 19 (or the reverse) selects the wrong Bridge API surface and can fail at runtime.",
    fix: 'Align the Bridge entry with the installed React major (`/v18` or `/v19`). Limit majors with `reactMajors`, or set the rule to `"off"`.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "bridge/provider-shape-invalid": {
    category: "correctness",
    impact:
      "Incomplete `createRemoteAppComponent` / `createBridgeComponent` options omit required loader/module or root component contracts and break Bridge remotes.",
    fix: 'Pass a complete options object (loader/module for consumers, or a root component for export-app). Fallback/loading UX is covered by `bridge/missing-fallback-loading`. Turn the rule `"off"` when source facts are too thin or the call shape is dynamic.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "bridge/ssr-server-entry-leak": {
    category: "correctness",
    impact:
      "Browser-only Bridge React entries must not load inside node/SSR builds; doing so leaks DOM-oriented Bridge code into the server bundle.",
    fix: 'Import the Bridge `/server` entry (or a node-safe path) for SSR/node targets. Override with `ssrMode: "browser-only"` when the build is not SSR, or set the rule to `"off"`.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "bridge/missing-fallback-loading": {
    category: "reliability",
    impact:
      "Bridge remotes without `fallback`/`loading` leave consumers with a blank screen while the remote loads or fails.",
    fix: 'Pass `fallback` and `loading` to `createRemoteAppComponent`, or set `rules["bridge/missing-fallback-loading"]` to `"off"`.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "bridge/consumer-api-manual": {
    category: "reliability",
    impact:
      "Hand-rolled `loadRemote` / remote mounts skip Bridge lifecycle helpers and lose documented loading/error contracts.",
    fix: 'Prefer `createRemoteAppComponent` / `createBridge` from `@module-federation/bridge-react`, or set the rule to `"off"`.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "bridge/export-app-missing": {
    category: "reliability",
    impact:
      "Bridge producers without `./export-app` break the conventional Bridge remote contract expected by hosts.",
    fix: 'Expose `"./export-app"` via `createBridgeComponent` (render/destroy), or set the rule to `"off"`.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "bridge/ssr-instanceid-hydration": {
    category: "tooling",
    impact:
      "Without a stable `bridge.instanceId`, SSR Bridge hydration registries can collide across requests.",
    fix: 'Set `bridge.instanceId` for SSR builds, use `ssrMode: "browser-only"` when not SSR, or set the rule to `"off"`.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "bridge/tanstack-router-conflict": {
    category: "tooling",
    impact:
      "Bridge router aliasing plus `@tanstack/react-router` can duplicate navigation ownership in one app.",
    fix: 'Disable Bridge router or isolate TanStack Router, or set `rules["bridge/tanstack-router-conflict"]` to `"off"`.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "bridge/disable-alias-deprecated": {
    category: "tooling",
    impact:
      "`bridge.disableAlias` is a deprecated escape hatch; explicit `enableBridgeRouter` communicates intent clearly.",
    fix: 'Prefer `enableBridgeRouter: false` (or true) over `disableAlias`, or set the rule to `"off"`.',
    sources: ["https://module-federation.io/guide/bridge/react-bridge"],
  },
  "ssr/node-remote-manifest": {
    category: "correctness",
    impact:
      "Node/SSR consumers that load the browser `mf-manifest.json` miss the server remote graph and can fail to resolve remotes during SSR.",
    fix: 'Point node/SSR remotes at `/ssr/mf-manifest.json` (or another env-specific path). Set `ssrMode: "browser-only"` when the build is not SSR, or turn the rule `"off"`.',
    sources: [
      "https://module-federation.io/guide/basic/manifest-snapshot.html",
      "https://module-federation.io/integrations/build-tool/rsbuild",
    ],
  },
  "ssr/node-runtime-plugin-missing": {
    category: "correctness",
    impact:
      "Without `@module-federation/node/runtimePlugin`, Node Federation hosts cannot load remotes with the server runtime contract.",
    fix: 'Add `@module-federation/node/runtimePlugin` to `runtimePlugins`. Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.',
    sources: [
      "https://module-federation.io/plugin/plugins/",
      "https://module-federation.io/blog/node",
    ],
  },
  "ssr/node-library-dts": {
    category: "reliability",
    impact:
      "Node/SSR producers that keep ESM-style `library.type` or enabled `dts` diverge from the commonjs dual-env contract used by server remotes.",
    fix: 'Set `library: { type: "commonjs-module" }` (or another commonjs-like type) and `dts: false` on node/SSR producers. Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.',
    sources: ["https://module-federation.io/blog/node"],
  },
  "bridge/vue-share-missing": {
    category: "correctness",
    impact:
      "Vue Bridge remotes and hosts that omit `vue` (and `vue-router` when used) from `shared` can load duplicate Vue runtimes and break reactivity or routing.",
    fix: 'Share `vue` (and `vue-router` when imported) as singletons, or set the rule to `"off"`.',
    sources: ["https://module-federation.io/integrations/practice/vue"],
  },
  "bridge/vue-ssr-fresh-context": {
    category: "reliability",
    impact:
      "Reusing one Vue app/router/store across SSR requests leaks request state between users.",
    fix: 'Create per-request app/router/store factories (or use Bridge SSR hydration helpers). Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.',
    sources: ["https://module-federation.io/integrations/practice/vue"],
  },
  "bridge/vue-server-entry": {
    category: "reliability",
    impact:
      "Browser-only Vue Bridge entries in node/SSR builds miss the server/hydration contract and can leak client-only Bridge code.",
    fix: 'Import `@module-federation/bridge-vue3/server` (or the documented SSR entry). Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.',
    sources: ["https://module-federation.io/integrations/practice/vue"],
  },
  "bridge/vue-consumer-manual": {
    category: "reliability",
    impact:
      "Hand-rolled `loadRemote` mounts skip Vue Bridge lifecycle helpers and documented loading/error contracts.",
    fix: 'Prefer `createRemoteAppComponent` from `@module-federation/bridge-vue3`, or set the rule to `"off"`.',
    sources: ["https://module-federation.io/integrations/practice/vue"],
  },
};
