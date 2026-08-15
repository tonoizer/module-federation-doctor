# Nested multi-bundler federation

Healthy nesting topology for MFDoctor dogfood:

```text
Vite host (5180)
├── Vite remote (3010)
│   └── Rspack remote (3012)
└── Rsbuild remote (3011)
    └── Webpack remote (3013)
```

Each app registers the matching MFDoctor adapter next to Module Federation. A
coordinated root build prints per-app MFDoctor output; then `mfdoctor workspace`
gates the emitted `.mf/doctor/project.json` facts.

## Green path

This suite stays clean on purpose (like `mixed-federation`). Consumers that point
at `remoteEntry.js` intentionally suppress:

- `config/remote-manifest-recommended`
- `reliability/version-first-offline-remotes` (Vite consumers)

Comments in each config explain why. For intentional red findings, use
[`mixed-federation-issues`](../mixed-federation-issues) or the one-rule
[`showcase`](../showcase) demos — not this tree.

## Commands

From the repo root (after `vp run build`):

```bash
vp run test:nested
# or:
vp run --filter './examples/nested-federation/**' build
node dist/cli.js workspace examples/nested-federation --format terminal,json
```

Preview (serve remotes, then host):

```bash
vp run --filter @mfdoctor-example/nested-remote-webpack preview &
vp run --filter @mfdoctor-example/nested-remote-rspack preview &
vp run --filter @mfdoctor-example/nested-remote-rsbuild preview &
vp run --filter @mfdoctor-example/nested-remote-vite preview &
vp run --filter @mfdoctor-example/nested-host-vite preview
```

| App              | Port | Role                               |
| ---------------- | ---- | ---------------------------------- |
| `host-vite`      | 5180 | Vite host → Vite + Rsbuild remotes |
| `remote-vite`    | 3010 | Vite remote → Rspack leaf          |
| `remote-rsbuild` | 3011 | Rsbuild remote → Webpack leaf      |
| `remote-rspack`  | 3012 | Rspack leaf                        |
| `remote-webpack` | 3013 | Webpack leaf                       |
