---
"@tonoizer/mfdoctor": patch
---

Hide agent fix prompts in CI by default (standard CI env vars / `mode: "ci"`). Local runs still print them; opt in with `--prompt` or dump via `--diagnostics-dir`.
