# Limitations

MVP supports Vite, direct Rspack, and Rsbuild. Webpack, Rolldown, Modern.js,
Vite Plus, and broad compatibility matrices are follow-up work. Static imports
cannot see every runtime import.

The Doctor plugin analyzes the **current** app (config + emit). Cross-app
host↔remote shared/integration issues need each app's `.mf/doctor/project.json`
plus `mfdoctor federation`, or an opt-in `mfdoctor probe` of a deployed
manifest.

Opt-in browser runtime trace import is available through `mfdoctor runtime` when
you supply an Observability Plugin export. Default `check` and `federation`
analysis stay offline.

Doctor does not ship an HTML dashboard. Use terminal, JSON, and SARIF reports.

Doctor does not rely on undocumented private Module Federation plugin fields.
