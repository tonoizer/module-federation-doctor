# `config/dts-output-dir-mismatch`

- Category: **reliability**
- Default severity: **warning**

## Issue

A nested remote-entry `filename` that disagrees with `dts.generateTypes.outputDir` can publish type archives to the wrong path.

## How to fix it

Align `filename` directory layout with `dts.generateTypes.outputDir`, or keep both at the output root.

Suppress or retarget with `rules["config/dts-output-dir-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
- [Official source](https://module-federation.io/configure/filename.html)
