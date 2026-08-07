# Vite + Nitro + React compatibility cell

This production fixture follows Nitro's official Vite SSR React example and
adds the Module Federation Vite plugin plus Doctor. It covers the two output
shapes emitted by Nitro:

- browser artifacts under `.output/public`, including `remoteEntry.js` and
  `mf-manifest.json`;
- server artifacts under `.output/server` and Nitro's transient
  `node_modules/.nitro/vite/services/ssr` environment.

The cell is intentionally part of the production compatibility matrix so a
server-only Doctor close cycle cannot regress into a false
`artifact/remote-entry-missing` finding.
