---
"@tonoizer/mfdoctor": minor
---

Promote `shared/prefix-share-recommended` to error for React and React DOM deep imports, and stop allowlisting `react/jsx-runtime` and `react-dom/client` by default so singleton/version crashes fail CI instead of staying silent.
