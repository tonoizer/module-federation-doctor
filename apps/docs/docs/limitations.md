# Limitations

MVP supports Vite, direct Rspack, and Rsbuild. Webpack, Rolldown, Modern.js,
Vite Plus, HTML analysis UI, and broad compatibility matrices are follow-up
work. Static imports cannot see every runtime import.

Opt-in browser runtime trace import is available through `mfdoctor runtime` when
you supply an Observability Plugin export. Default `check` and `federation`
analysis stay offline.

Doctor does not rely on undocumented private Module Federation plugin fields.
