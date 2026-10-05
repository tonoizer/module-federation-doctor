---
"@tonoizer/mfdoctor": patch
---

Parse manifest `metaData.ssrRemoteEntry` and report `artifact/manifest-remote-entry-missing` when that SSR entry was advertised but not present in any collected emit/output. Split client/server builds stay quiet when the doctor collected the server asset.
