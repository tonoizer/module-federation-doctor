<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Performance checks

Performance advice must preserve runtime correctness. Module Federation owns
part of the chunk and initialization graph, so generic bundler advice can be
harmful.

## Analysebudgets

MFDoctor bounds source and workspace collection before parsing. Configure the
typed `analysisBudgets` option when a repository needs tighter limits:

```ts
export default {
  analysisBudgets: {
    maxFiles: 10_000,
    maxSourceBytes: 50 * 1024 * 1024,
    maxArtifacts: 10_000,
    maxEvidenceNodes: 100_000,
    maxSerializedBytes: 50 * 1024 * 1024,
    maxWallTimeMs: 30_000,
  },
};
```

Files and bytes are selected in sorted path order. A limit stops further
collection without silently claiming completeness: project analysis emits the
existing `doctor/partial-analysis` finding and workspace analysis returns exit
code `2` with unknown input. Artifact records are also selected in sorted path
order and capped before JSON parsing; hitting `maxArtifacts` produces the same
partial analysis signal. Imported evidence uses the same tracker: the node and
serialized-byte reservation happens before copying, graph normalization, or
stable-ID hashing. Bytes mean the UTF-8 size of the raw JSON representation,
including keys and separators, and a rejected reservation is atomic. The reader
throws a typed `EvidenceReaderError` with `failureCode: "budget-exceeded"` and
its budget report; it does not return a clipped graph. Budget-clipped rule
processing returns `unknown` with partial completeness, so no finding is treated
as conclusive from clipped input. Legacy project/report schemas and normal runs
stay unchanged. Runtime collection has a separate budget later. Projection helpers accept an optional `analysisBudget`
and reserve the normalized input and complete output as separate atomic units;
they never return silently truncated v1 data.

Source and discovered-artifact reads use a fixed worker bound and reduce results
in sorted path order, so concurrency does not change file selection or report
ordering. Applications that run multiple analyses in one process can opt into a
bounded parsed-input cache:

```ts
import { AnalysisContentCache } from "@tonoizer/mfdoctor";

const analysisCache = new AnalysisContentCache({
  maxEntries: 256,
  maxBytes: 16 * 1024 * 1024,
});

await analyze({ analysisCache });
```

The cache is process-local and opt-in. Entries are invalidated by source or
artifact content digest and include adapter/config identity in their key; the
LRU entry and byte ceilings prevent unbounded retention. It does not replace a
remote or daemon cache. The checked-in `pnpm benchmark:analysis` command runs
the small/medium/large fixtures twice through the legacy, shadow, and explicitly
gate-promoted v2-compat controller selections. It records wall time/RSS/budget
usage/cache reuse, checks stable v1 output, and uses the existing
`readEvidenceFile` seam when fixture evidence is present. The v2-compat row
measures the current v1 collector at the rollout-controller seam; it does not
claim a separate v2 collector is enabled. Mixed Vite/Rspack/Rsbuild/Webpack
coverage is provided by the existing compatibility matrix rather than this
source-only benchmark.

## Startstrategie

Issue: `version-first` loads every configured remote entry during
initialization so all shared versions are known. With many remotes, this adds
startup requests and makes an offline remote an early failure.

Fix: use `loaded-first` when reuse of already loaded packages and on-demand
remote loading matter more than choosing the highest available version. If
`version-first` is required, add an `errorLoadRemote` runtime plugin with an
explicit recovery policy.

Source:
[shareStrategy](https://module-federation.io/configure/shareStrategy.html).

## Asset-Budgets

MFDoctor can fail (or warn on) federation assets whose on-disk sizes exceed project
budgets. Sizes come from joining `mf-manifest.json` asset names to files under
the project root (and emitted assets from a MFDoctor adapter build). Manifest and
stats JSON do not carry byte sizes by themselves.

Default limits for [`performance/asset-budget`](./rules/performance/asset-budget.md):

- remote entry file: **512 KiB** (`524288`)
- each shared package asset sum: **512 KiB** (`524288`)
- each expose asset sum: **350 KiB** (`358400`)

Default severity is `warning`. Override thresholds or severity in
`mfdoctor.config`:

```ts
export default {
  rules: {
    "performance/asset-budget": [
      "error",
      {
        remoteEntryMaxBytes: 150_000,
        sharedMaxBytes: 400_000,
        exposeMaxBytes: 250_000,
      },
    ],
  },
};
```

Set the rule to `"off"` to disable it. When no listed asset can be sized (for
example before a build), the rule reports nothing.

## Externe Laufzeit

Issue: each remote can bundle its own `@module-federation/runtime-core`.

Fix: a pure top consumer may enable `provideExternalRuntime`, while browser
remotes enable `externalRuntime`. The provider must run first. Do not add
`provideExternalRuntime` to a producer; the upstream plugin rejects that
combination.

This can reduce duplicate runtime code, but it changes deployment order into a
hard contract. MFDoctor checks both local invalid combinations and the
federation-wide provider.

Source:
[experiments](https://module-federation.io/configure/experiments.html).

## Tree Shaking von Shared-Modulen

Issue: large shared component libraries can transfer exports no application
uses.

Fix:

- use `runtime-infer` for local development and safe fallback;
- use `server-calc` only when a deployment service collects every consumer's
  used exports, builds the union, publishes the secondary artifact, and updates
  the snapshot;
- do not combine `eager: true` with shared tree shaking;
- set `injectTreeShakingUsedExports: false` for `server-calc`.

If any deployment step is missing, the runtime falls back to the full package.
That is safe but means the expected size win did not happen.

Sources:
[shared](https://module-federation.io/configure/shared.html),
[treeShakingDir](https://module-federation.io/configure/treeShakingDir.html),
and the
[Vite implementation notes](https://github.com/module-federation/vite/blob/321d7db8a4b2a1764b3a7cdc16246222d97231ac/README.md).

## Entfernen von Laufzeitfähigkeiten

Vite can remove unused remote, shared, and snapshot runtime features. Core
exposes matching optimization flags under `experiments.optimization`.

- `disableRemote` is only safe with no remotes.
- `disableShared` is only safe with no shared packages.
- `disableSnapshot` removes manifest remotes, preload, dynamic type hints, HMR,
  and DevTools integration.

MFDoctor reports a hard error when a removed capability is still configured. It
reports snapshot loss as reliability risk because the build may run while
important tooling silently disappears.

## Vite-specific costs

- `bundleAllCSS: true` attaches all CSS to every expose. Use it only when each
  expose needs the full style set.
- Large projects should prefer `moduleParseIdleTimeout` over a short fixed
  `moduleParseTimeout`.
- User `manualChunks` and custom `codeSplitting.groups` are ignored by the
  official plugin because they can break federation initialization order. Let
  the plugin isolate `loadShare` and runtime-init chunks.

Source:
[Vite plugin source](https://github.com/module-federation/vite/blob/321d7db8a4b2a1764b3a7cdc16246222d97231ac/src/index.ts).
