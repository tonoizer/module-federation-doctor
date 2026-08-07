# Vite 5 CommonJS compatibility cell

This is a small production build that loads both the Module Federation Vite
plugin and Doctor through `require()` from a `.cjs` config. It protects the
published CommonJS adapter entry and the older Vite 5 lifecycle path.
