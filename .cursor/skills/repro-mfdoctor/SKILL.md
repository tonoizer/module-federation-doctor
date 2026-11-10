---
name: repro-mfdoctor
description: Reproduce a reported @tonoizer/mfdoctor bug from a GitHub issue (number or URL) with CLI evidence. Use before fixing check, workspace, federation, runtime, or capabilities behavior. Does not post comments, label, close, or merge. A reproduced bug yields a draft PR with a failing test and a repro report, not the fix.
---

# Reproduce an mfdoctor bug

Given a GitHub issue that reports an `@tonoizer/mfdoctor` bug, reproduce it
with proof. Primary surface is the CLI built from current `main`
(`node dist/cli.js`) and, when the report is about emit, a post-emit
`federationDoctor` build. This is not the docs site, not an HTML dashboard,
not an in-browser doctor, and not a general `--fix`.

Read `.cursor/skills/verify-mfdoctor` for command shapes, exit codes, and
JSON keys. Read `features/README.md` there only to pick which command the
issue is about.

The only GitHub write this skill allows is an optional **draft** pull request
after a bug is reproduced. Do not post issue comments, add or remove labels,
close issues, or merge. The operator decides what gets posted.

## 1. Read the issue

Accept an issue number or a `github.com/.../issues/<n>` URL for
`tonoizer/module-federation-doctor`. Read the body with `gh issue view`. Do
not scrape HTML.

Extract:

- mfdoctor version, Node version, and bundler (and bundler version if given)
- the reproduction repository, or an attached `.mf` report (`project.json` /
  `report.json`)
- the exact mfdoctor command
- expected behavior and actual behavior

If any of those is missing, stop. Draft a short comment that asks only for the
missing items. Do not post it. Put the draft in the repro report and hand it
to the operator.

Do not invent a reproduction repo, versions, or expected output.

## 2. Isolate and run

Build mfdoctor from current `main`, not from a fix branch:

```bash
git fetch origin main
git worktree add --detach /tmp/mfdoctor-repro-src origin/main
cd /tmp/mfdoctor-repro-src
pnpm install --frozen-lockfile
pnpm build
test -f dist/cli.js
node dist/cli.js capabilities
```

`capabilities` must exit `0` and print JSON (`schemaVersion`,
`package.name` = `@tonoizer/mfdoctor`). If it does not, stop and report the
build failure. Do not Drive.

Clone or unpack the reporter's reproduction into its own temp dir
(`/tmp/mfdoctor-repro-<issue>/app`). Do not mutate the reporter's checkout or
tracked examples. When the only reproduction is an in-repo fixture, copy that
fixture into the temp dir and point the `main` binary at the copy.

Run the command the issue names. If they did not name one, run the offline
command that matches the report:

```bash
node dist/cli.js check <project> --ci --format json --output - --no-write
node dist/cli.js workspace <root> --ci --format json --output - --no-write
node dist/cli.js federation "<glob-to-project.json>" --ci --format json --output - --no-write
node dist/cli.js runtime <trace.json> "<glob-to-project.json>" --format json --output - --no-write
```

Record, for every command, the argv, cwd, exit code, stdout, and stderr.
Prefer stdout JSON over ANSI terminal text. Exit `0` is policy pass, `1` is
policy fail, `2` is incomplete. `--require-complete` on `check`, `workspace`,
and `federation` turns incomplete evidence into `1`.

Confirm `--no-write` by checking that `.mf/doctor` was not created in the temp
copy. When the issue is about files the CLI should write, use a temp copy and
record the artifact paths that appeared.

## 3. Classify

Use the recorded exit code and JSON (`status`, `findings[].ruleId`,
`status.incompleteReasons`). One of:

| Class             | When                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reproduced        | Current `main` shows the reported actual behavior, and that contradicts the expected behavior                                                            |
| not reproduced    | Current `main` shows the expected behavior, or the actual behavior cannot be triggered                                                                   |
| works as designed | The result matches the documented contract; the report misreads a rule or an exit code                                                                   |
| out of scope      | The request needs a new bundler adapter, private Module Federation fields, an HTML UI, an in-browser agent, a general `--fix`, or a client-bundle doctor |

Out of scope is a classification, not a design task. Say which boundary it
hits and stop. Do not start that work.

## 4. If reproduced

Minimize. Do not invent a fixture layout. Put the reduced case next to the
fixtures tests already use:

- One-rule CLI cases live in `examples/showcase/<group>/<case>/` and are
  registered in `scripts/demo-showcase.mjs` (`dir` or `pattern`, `ruleId`,
  `expectedExit`). Match a sibling: `mfdoctor.config.ts`, `package.json`, and
  `src/` for `check`; `*.project.json` for `federation`; `trace.json` plus
  `*.project.json` for `runtime`. `test/unit/showcase-catalog.test.ts` locks
  that catalog.
- Saved emit facts and multi-app trees live under `fixtures/<topic>/`.
  Workspace gates use `fixtures/workspaces/<name>/<app>/.mf/doctor/project.json`
  (`fixtures/workspaces/README.md`). Point a `test/unit` or `test/integration`
  file at that path the way neighboring tests do.

Add a failing test that encodes the **expected** behavior (the assertion fails
on current `main`). Prefer extending the test file that already covers that
rule id. Run the focused test and record the failure.

Open a **draft** pull request that contains only that fixture, the failing
test, and the repro report. Do not include a fix. Do not merge it.

If the class is anything else, do not add a fixture, test, or pull request.

## 5. Duplicates

Before the report is final, search existing issues and rule ids. Examples:

```bash
gh issue list --repo tonoizer/module-federation-doctor --state all \
  --search "<ruleId or distinctive phrase>" --limit 20
node /tmp/mfdoctor-repro-src/dist/cli.js rules
```

Also search `src/rule-inventory.ts` for the rule id. In the report, name any
matching issue number and whether that rule id already exists. Do not close or
label the duplicate.

## 6. Report

Write the report in the draft PR body when a PR exists, otherwise leave it for
the operator. Include:

- issue number and URL
- versions, bundler, and the reproduction used
- SHA of `main` that was built
- exact commands, exit codes, and the relevant JSON fields (rule ids, status)
- classification and the evidence for it
- duplicate issues and rule ids
- the unposted comment draft, if step 1 stopped
- redaction notes

Redact secrets, tokens, cookies, and machine-specific home paths before the
report leaves the temp dir. Quote rule ids and exit codes, not raw local paths.

## Gotchas

- Do not run `probe` or `compare` unless the issue is about that command. They
  hit the network.
- Do not claim green from `check` alone. Exit `2` and
  `doctor/partial-analysis` are incomplete, not a pass.
- Stay post-emit. Do not add an HTML UI, an in-browser agent, a general
  `--fix`, a new bundler adapter, a client-bundle doctor, or scraping of
  private Module Federation fields while reproducing.
- `pnpm install --frozen-lockfile` must keep the `minimumReleaseAge` gate. Do
  not add `minimumReleaseAgeExclude` entries to make the install succeed.
- Cleanup: remove the worktree and `/tmp/mfdoctor-repro-*` when the report
  has the evidence it needs. Do not delete the reporter's clone outside that
  temp dir.

## Non-goals

- Posting comments, labels, closes, or merges
- The bugfix itself
- HTML UI / `--ui`, in-browser doctor, general `--fix`
- New bundler adapters, private Module Federation field scraping, a
  client-bundle doctor
- `docs:dev` as the reproduction surface
