# mf-bridge-entry

In-repo stand-in for **mf-toolkit mf-bridge** shapes (no toolkit checkout required).

| Path                             | What it proves                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `remote/src/entry.ts`            | Expose `./entry` exporting `register` / `createMFEntry` / `defineMFEntry` stubs      |
| `remote/.mf/doctor/project.json` | Golden project facts: `exposes["./entry"]`                                           |
| `host/src/HostSlot.tsx`          | Lazy `register={() => import('remote/entry')}` host pattern (source signal for #127) |
| `host/.mf/doctor/project.json`   | Host remotes + `imports.sourceFiles` pointing at `HostSlot.tsx`                      |

Used by #127 recognition; this fixture issue (#145) only lands the shapes.
