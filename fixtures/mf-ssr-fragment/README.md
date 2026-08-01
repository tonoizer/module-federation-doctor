# mf-ssr-fragment

In-repo stand-in for **mf-toolkit mf-ssr** fragment URL mode (no toolkit checkout).

| Path                             | What it proves                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `host/src/CheckoutSlot.tsx`      | Host embeds fragment via `url=` (not classic `remoteEntry.js`)                                                      |
| `host/.mf/doctor/project.json`   | Remotes whose `entry` is a fragment URL/path (absolute HTTPS + relative `/api/fragments/...`), not `remoteEntry.js` |
| `remote/src/fragment-route.ts`   | Fragment HTTP handler stub                                                                                          |
| `remote/.mf/doctor/project.json` | Remote exposes `./fragment` instead of a component widget                                                           |

#127 should treat these remotes as intentional fragment SSR based on **entry URL shape**
(and host source `url=` usage), not an invented remote `type` field — real MF configs do not emit `type: "mf-ssr-fragment"`.
