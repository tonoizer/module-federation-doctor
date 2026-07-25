---
pageType: home

hero:
  name: Module Federation Doctor
  text: Diagnostics for federation projects
  tagline: Register the build plugin next to Module Federation. Doctor prints findings after emit, then fails CI only when policy says so. Fix until the build exits 0.
  actions:
    - theme: brand
      text: Get started
      link: /setup
    - theme: alt
      text: Rule reference
      link: /rules/

features:
  - title: One plugin call
    details: Vite, Rspack, Rsbuild, and Webpack adapters run after emit. Clean builds stay quiet; findings include fix hints and docs links.
  - title: Clear rule catalog
    details: Config, shared, artifact, reliability, runtime, federation, performance, and security rules — each with issue, impact, and fix.
  - title: Governance without silence
    details: Mute known rules with rules off, severity overrides, policy packs, or fingerprint baselines — keep Doctor on.
  - title: CI and agents
    details: Terminal, JSON, and SARIF. CI auto-detect fails on errors. Agents should fix printed findings until the build exits 0.
---
