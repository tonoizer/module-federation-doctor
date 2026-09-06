# `config/split-chunks-mf-runtime`

- Category: **reliability**
- Default severity: **warning**

## Issue

User cacheGroups that target mf-* / remoteEntry / shared-runtime chunks can steal Module Federation runtime and shared ownership, breaking init order or duplicate-share isolation. This is an advisory for observed public splitChunks only; MFDoctor does not nag every project to set chunks: "async".

## How to fix it

Exclude federation runtime chunks from cacheGroups (name, test, and filename). Leave MF-owned remoteEntry and shared-runtime chunks to the federation plugin, or allowlist a proven layout with `allowSplitChunks: true`.

Suppress or retarget with `rules["config/split-chunks-mf-runtime"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://webpack.js.org/plugins/split-chunks-plugin/)
- [Official source](https://rspack.rs/config/optimization#optimizationsplitchunks)
- [Official source](https://rsbuild.rs/config/performance/chunk-split)
