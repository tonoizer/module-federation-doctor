# Modern.js compatibility smoke

Exercises `@module-federation/doctor/modern` the way Modern.js registers plugins:
`modifyBundlerChain` attaches the same post-emit Doctor hook used by direct
Rspack. The smoke build uses `@rspack/core` + `@module-federation/enhanced/rspack`
under the hood (what Modern.js does internally) so CI stays light without
pulling `@modern-js/app-tools`.

**Not** a replacement for `@module-federation/doctor/rspack` — bare Rspack apps
keep using that entry. See `modern.config.mjs` for the real Modern.js config
shape and `README` / setup docs for Modern.js vs Rspack vs Rsbuild.
