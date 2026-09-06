---
"@tonoizer/mfdoctor": minor
---

Add `config/hashed-remote-filename` to warn when webpack/rspack Module Federation `filename` (or observed `output.filename` when the container name is unset) uses `[hash]` / `[contenthash]` templates that break stable remote URLs.
