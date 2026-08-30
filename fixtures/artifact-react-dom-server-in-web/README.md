# artifact-react-dom-server-in-web

Offline proof for `artifact/react-dom-server-in-web` (#329).

| Path                          | What it proves                                     |
| ----------------------------- | -------------------------------------------------- |
| `web/src/Widget.tsx`          | Web remote accidentally imports `react-dom/server` |
| `web/.mf/doctor/project.json` | Web/client target facts — rule must fire           |
| `ssr/src/render.tsx`          | SSR entry correctly imports `react-dom/server`     |
| `ssr/.mf/doctor/project.json` | Node/SSR target facts — rule must stay quiet       |
