---
"@tonoizer/mfdoctor": minor
---

Add a Modern.js-oriented adapter (`@tonoizer/mfdoctor/modern`) that
composes the same post-emit analysis as the public Rspack/Webpack adapters via
`modifyBundlerChain`, with docs that keep direct Rspack and Rsbuild first-class.
Matrix status is **partial** until a real `@modern-js/app-tools` CI smoke lands.
The Modern.js entry exposes the `moduleFederationDoctorPlugin` factory.
