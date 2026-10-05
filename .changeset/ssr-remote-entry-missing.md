---
"@tonoizer/mfdoctor": patch
---

Parse manifest `metaData.ssrRemoteEntry` and report `artifact/manifest-ssr-remote-entry-missing` (warning) when that SSR entry was advertised but not present in any collected emit/output. Split client/server builds stay quiet when the doctor collected the server asset. `artifact/manifest-remote-entry-missing` still only checks the client `remoteEntry`.
