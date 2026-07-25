# Performance checks

Performance advice must preserve runtime correctness. Module Federation owns
part of the chunk and initialization graph, so generic bundler advice can be
harmful.

## Startup strategy

Issue: `version-first` loads every configured remote entry during
initialization so all shared versions are known. With many remotes, this adds
startup requests and makes an offline remote an early failure.

Fix: use `loaded-first` when reuse of already loaded packages and on-demand
remote loading matter more than choosing the highest available version. If
`version-first` is required, add an `errorLoadRemote` runtime plugin with an
explicit recovery policy.

Source:
[shareStrategy](https://module-federation.io/configure/shareStrategy.html).

## Asset budgets

Doctor can fail (or warn on) federation assets whose on-disk sizes exceed project
budgets. Sizes come from joining `mf-manifest.json` asset names to files under
the project root (and emitted assets from a Doctor adapter build). Manifest and
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

## External runtime

Issue: each remote can bundle its own `@module-federation/runtime-core`.

Fix: a pure top consumer may enable `provideExternalRuntime`, while browser
remotes enable `externalRuntime`. The provider must run first. Do not add
`provideExternalRuntime` to a producer; the upstream plugin rejects that
combination.

This can reduce duplicate runtime code, but it changes deployment order into a
hard contract. Doctor checks both local invalid combinations and the
federation-wide provider.

Source:
[experiments](https://module-federation.io/configure/experiments.html).

## Shared tree shaking

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

## Runtime capability removal

Vite can remove unused remote, shared, and snapshot runtime features. Core
exposes matching optimization flags under `experiments.optimization`.

- `disableRemote` is only safe with no remotes.
- `disableShared` is only safe with no shared packages.
- `disableSnapshot` removes manifest remotes, preload, dynamic type hints, HMR,
  and DevTools integration.

Doctor reports a hard error when a removed capability is still configured. It
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
