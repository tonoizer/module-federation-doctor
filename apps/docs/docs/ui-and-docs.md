# UI and documentation design

Vitest provides useful design ideas, but Doctor has a different job.

## What Doctor adopts

- status-first error/warning/info counts,
- fast filters and search,
- expandable evidence,
- light and dark system themes,
- local docs search and generated reference pages,
- one report file that can be attached to CI.

The implementation is a static `report.html`. It makes no network requests,
loads no remote assets, and renders only Doctor's redacted report. This keeps it
safe and portable.

## What Doctor does not copy

Vitest's UI is a live test runner with WebSocket state, rerun controls, source
editing, coverage, and a module graph. Doctor does not yet need a long-running
server or write controls. Adding those would enlarge the attack surface and
make a simple build diagnostic harder to archive.

If future runtime probes need a live dashboard, the next step should be a
read-only server with explicit opt-in, loopback binding, request limits, and no
remote execution. It should consume the same stable report schema rather than
create a second diagnostics model.

Sources:
[Vitest docs config](https://github.com/vitest-dev/vitest/blob/a31f86af738b2979905f6a61eb5d8848d489eed7/docs/.vitepress/config.ts)
and
[Vitest dashboard](https://github.com/vitest-dev/vitest/blob/a31f86af738b2979905f6a61eb5d8848d489eed7/packages/ui/client/components/Dashboard.vue).
