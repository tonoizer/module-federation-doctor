# mf-ssr-fragment

In-repo stand-in for **mf-toolkit mf-ssr** fragment URL mode (no toolkit checkout).

| Path                             | What it proves                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `host/src/CheckoutSlot.tsx`      | Host embeds fragment via `url=` (not classic `remoteEntry.js`)                  |
| `host/.mf/doctor/project.json`   | Remotes with fragment entries + `type: "mf-ssr-fragment"` (absolute + relative) |
| `remote/src/fragment-route.ts`   | Fragment HTTP handler stub                                                      |
| `remote/.mf/doctor/project.json` | Remote exposes `./fragment` instead of a component widget                       |

#127 should treat these remotes as intentional fragment SSR, not broken classic entries.
