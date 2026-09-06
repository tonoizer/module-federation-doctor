---
"@tonoizer/mfdoctor": patch
---

Drive `supportedBundlers` in the rule catalog and engine from inventory adapters so Vite-only rules report `["vite"]` from `mfdoctor rules`. Shared rules still run when bundler detection is `unknown`.
