# Workspace reports

Federation integration and CLI workspace-gate tests use portable
`project.json` trees here:

- `clean/` — host + remote with compatible shared React (exit 0)
- `conflict/` — host + remote with a shared version conflict (exit 1)

Layout mirrors real multi-app emits: `<app>/.mf/doctor/project.json`.
