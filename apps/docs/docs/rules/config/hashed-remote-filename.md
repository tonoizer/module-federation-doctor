# `config/hashed-remote-filename`

- Category: **reliability**
- Default severity: **warning**

## Issue

Hashed remote entry filenames invalidate consumer URLs whenever the producer rebuilds. Webpack/Rspack `[contenthash]` in Module Federation `filename`, or in `output.filename` when the container filename is unset, has the same effect as Vite `[hash]`.

## How to fix it

Use a stable Module Federation `filename` such as `remoteEntry.js`. Keep hashing on chunk filenames instead of the container entry.

Suppress or retarget with `rules["config/hashed-remote-filename"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/filename.html)
- [Official source](https://webpack.js.org/configuration/output/#outputfilename)
