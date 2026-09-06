# Nuxt compatibility smoke

Exercises `@tonoizer/mfdoctor/nuxt` the way a Nuxt app registers it:

```ts
modules: [["@tonoizer/mfdoctor/nuxt", { moduleFederation: mfOptions }]];
```

The smoke build (`build.mjs`) loads that `nuxt.config` through Nuxt's public
`vite:extendConfig` hook, then runs a Vite production build with
`@module-federation/vite` under the hood (what `@module-federation/nuxt` does
internally). CI stays light without pulling Nuxt or `@module-federation/nuxt`.

This is **adapter API + Vite-under-the-hood** evidence — enough for a
**partial** matrix cell, not a full **supported** claim until a real
`@module-federation/nuxt` app build lands in CI. The upstream example remains
baseline-blocked ([nuxt/nuxt#36009](https://github.com/nuxt/nuxt/issues/36009)).

Copy `nuxt.config.mjs` into a real Nuxt 3/4 app and add
`"@module-federation/nuxt"` next to the doctor module (see the integrations
docs). **Not** a replacement for `@tonoizer/mfdoctor/vite` — bare Vite apps
keep using that entry.
