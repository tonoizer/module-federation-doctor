---
"@tonoizer/mfdoctor": minor
---

Make the bundler plugins the primary Doctor DX with ecosystem-named exports
(`federationDoctor`, `moduleFederationDoctorPlugin`,
`pluginModuleFederationDoctor`), collect every finding before failing the
build, drop the HTML UI, and auto-detect CI mode from common provider env vars
so plugin configs do not need `mode: "ci"` by default.
