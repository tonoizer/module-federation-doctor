---
pageType: home

hero:
  name: Module Federation Doctor
  text: Diagnostics for federation projects
  tagline: Offline-first checks for Vite, Rspack, and Rsbuild. Register the build plugin next to Module Federation and gate CI with terminal, JSON, and SARIF reports.
  actions:
    - theme: brand
      text: Get started
      link: /setup
    - theme: alt
      text: Rule reference
      link: /rules/
  image:
    src: /doctor-tooling-icon.png
    alt: Module Federation Doctor icon

features:
  - title: Config and shared checks
    details: Catch name, expose, remote, shared, and plugin mismatches before they ship.
  - title: Artifact evidence
    details: Validate manifests, remote entries, types, and emitted Doctor project facts from real builds.
  - title: Offline by default
    details: Local analysis stays offline. Use probe only when you intentionally inspect a deployed manifest.
  - title: CI-ready reports
    details: Terminal, JSON, and SARIF output you can attach to pull requests. CI=true fails the build on error findings after every issue is collected.
---
