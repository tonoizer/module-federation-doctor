# Modern.js compatibility smoke

Exercises `@tonoizer/mfdoctor/modern` the way Modern.js registers plugins:
`modifyBundlerChain` attaches the same post-emit Doctor hook used by direct
Rspack. The smoke build uses `@rspack/core` + `@module-federation/enhanced/rspack`
under the hood (what Modern.js does internally) so CI stays light without
pulling `@modern-js/app-tools`.

This is **adapter API + Rspack-under-the-hood** evidence — enough for a
**partial** matrix cell, not a full **supported** claim until a real
`@modern-js/app-tools` build lands in CI (#130).

**Not** a replacement for `@tonoizer/mfdoctor/rspack` — bare Rspack apps
keep using that entry. See `modern.config.mjs` for the real Modern.js config
shape and `README` / setup docs for Modern.js vs Rspack vs Rsbuild.
