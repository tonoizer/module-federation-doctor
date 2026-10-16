---
"@tonoizer/mfdoctor": patch
---

Report `federation/vite-webpack-nonsingleton-share` when a Vite container's emitted `@module-federation/vite` version is in `[1.22.0, 1.23.4)` and a webpack/rspack/enhanced peer shares the same package as a non-singleton. That combination crashes Vite remote `loadShare` with RUNTIME-015 on reload (https://github.com/module-federation/vite/issues/1429). Unknown plugin version or missing peer evidence stays quiet. Upgrade `@module-federation/vite` to >=1.23.4.
