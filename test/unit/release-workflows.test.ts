import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("release workflow contracts", () => {
  it("uses a pinned Vite+ setup action with frozen installs", async () => {
    const action = await readFile(".github/actions/setup-vp/action.yml", "utf8");

    expect(action).toContain(
      "voidzero-dev/setup-vp@313600b80b104eadebb9111787d37a2e83e014ca # v1.17.0",
    );
    expect(action).toContain("run-install: false");
    expect(action).toContain("vp install --frozen-lockfile");
  });

  it("formats generated inventory without constructing a shell command", async () => {
    const generator = await readFile("scripts/generate-rule-inventory.mjs", "utf8");

    expect(generator).toContain('execFileSync(process.execPath, [vitePlusCli, "fmt", tempPath]');
    expect(generator).not.toContain("execSync(");
  });

  it("publishes only an immutable version tag through staged OIDC publishing", async () => {
    const workflow = await readFile(".github/workflows/publish-on-release.yml", "utf8");

    expect(workflow).toContain("types: [published]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.event.release.tag_name || inputs.tag");
    expect(workflow).not.toContain("ref: ${{ needs.resolve-ref.outputs.sha }}");
    expect(workflow).toContain("description: Existing plain-semver tag");
    expect(workflow).not.toContain("description: Branch or plain semver tag");
    expect(workflow).toContain('test "${TAG}" = "${VERSION}"');
    expect(workflow).toContain('git tag --points-at HEAD --list "${TAG}"');
    expect(workflow).toContain("npm install --global npm@11.17.0");
    expect(workflow).toContain("node-version: [22, 24, 26]");
    expect(workflow).toContain("id-token: write");
    expect(workflow.indexOf("id-token: write")).toBeGreaterThan(workflow.indexOf("stage:"));
    expect(workflow).toContain("environment: npm");
    expect(workflow).toContain("package-exists:");
    expect(workflow).toContain("First-package bootstrap required");
    expect(workflow).toContain("if: needs.resolve-ref.outputs.package-exists == 'true'");
    expect(workflow).toContain("npm stage publish . --access public");
    expect(workflow).not.toMatch(/run:\s+npm publish(?!\s+--dry-run)/);
    expect(workflow).not.toContain("NPM_TOKEN");
  });

  it("builds Pages with least privilege and deploys only from main", async () => {
    const workflow = await readFile(".github/workflows/docs-pages.yml", "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("pages: read");
    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("github.event_name == 'push'");
    expect(workflow).toContain("environment:");
    expect(workflow).toContain("name: github-pages");
    expect(workflow).toContain("path: apps/docs/doc_build");
  });

  it("uses Changesets only to prepare a reviewed version PR", async () => {
    const workflow = await readFile(".github/workflows/changesets.yml", "utf8");

    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).toContain("changesets/action@");
    expect(workflow).toContain("version: vp run version");
    expect(workflow).toContain("commitMode: github-api");
    expect(workflow).not.toMatch(/version: pnpm version(?:\r?\n|$)/);
    expect(workflow).not.toMatch(/^\s+publish:/m);
    expect(workflow).not.toMatch(/run:\s+(?:pnpm|npm) publish/);
    expect(workflow).not.toContain("NPM_TOKEN");
  });

  it("creates a release only after the Changesets version PR merges", async () => {
    const workflow = await readFile(".github/workflows/create-release.yml", "utf8");

    expect(workflow).toContain("types: [closed]");
    expect(workflow).toContain("github.event.pull_request.merged == true");
    expect(workflow).toContain("changeset-release/main");
    expect(workflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(workflow).toContain("require('./package.json').version");
    expect(workflow).toContain('git tag --annotate "$VERSION"');
    expect(workflow).toContain("--generate-notes");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain('gh workflow run release-files.yml --ref main -f "tag=$VERSION"');
    expect(workflow).toContain(
      'gh workflow run publish-on-release.yml --ref main -f "tag=$VERSION"',
    );
    expect(workflow).not.toMatch(/(?:pnpm|npm) publish/);
  });
});
