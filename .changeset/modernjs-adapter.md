---
"@module-federation/doctor": minor
---

Add a Modern.js-oriented adapter (`@module-federation/doctor/modern`) that
composes the same post-emit analysis as the public Rspack/Webpack adapters via
`modifyBundlerChain`, with docs that keep direct Rspack and Rsbuild first-class.
Matrix status is **partial** until a real `@modern-js/app-tools` CI smoke lands.
