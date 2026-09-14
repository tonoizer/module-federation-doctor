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
    expect(action).toContain("cache: ${{ inputs.cache }}");
    expect(action).toContain('default: "true"');
  });

  it("formats generated inventory without constructing a shell command", async () => {
    const generator = await readFile("scripts/generate-rule-inventory.mjs", "utf8");

    expect(generator).toContain('execFileSync(process.execPath, [vitePlusCli, "fmt", tempPath]');
    expect(generator).not.toContain("execSync(");
  });

  it("uses the release tag for release events and the required tag input for dispatches", async () => {
    const workflow = await readFile(".github/workflows/release-files.yml", "utf8");
    const tagExpression = "github.event.release.tag_name || inputs.tag";

    expect(workflow.split(tagExpression)).toHaveLength(4);
    expect(workflow).toContain("ref: ${{ " + tagExpression + " }}");
    expect(workflow).toContain("RELEASE_TAG: ${{ " + tagExpression + " }}");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("description: Existing plain-semver GitHub release tag");
    expect(workflow).toContain("required: true");
    expect(workflow).not.toContain("ref: main");
    expect(workflow).not.toContain("github.event_name == 'workflow_dispatch' && 'main'");
  });

  it("verifies the requested tag commit before building or uploading release files", async () => {
    const workflow = await readFile(".github/workflows/release-files.yml", "utf8");
    const verify = workflow.indexOf("- name: Verify release tag");

    expect(verify).toBeGreaterThan(-1);
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain('RELEASE_COMMIT="$(git rev-parse "${RELEASE_TAG}^{commit}")"');
    expect(workflow).toContain('CHECKED_OUT_COMMIT="$(git rev-parse HEAD)"');
    expect(workflow).toContain('test "$RELEASE_COMMIT" = "$CHECKED_OUT_COMMIT"');
    expect(workflow).toContain('git tag --points-at HEAD --list "$RELEASE_TAG"');
    expect(workflow).toContain('test "$REMOTE_COMMIT" = "$RELEASE_COMMIT"');
    expect(workflow).toContain("needs: build-release-files");
    expect(verify).toBeLessThan(workflow.indexOf("uses: ./.github/actions/setup-vp"));
    expect(verify).toBeLessThan(workflow.indexOf("- name: Pack release files"));
    expect(verify).toBeLessThan(workflow.indexOf("- name: Upload release files"));
  });

  it("publishes only an immutable version tag through staged OIDC publishing", async () => {
    const workflow = await readFile(".github/workflows/publish-on-release.yml", "utf8");

    expect(workflow).toContain("types: [published]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.event.release.tag_name || inputs.tag");
    expect(workflow).toContain("path: .release-tooling");
    expect(workflow).toContain("cp .release-tooling/scripts/pack-check.mjs scripts/pack-check.mjs");
    expect(workflow).toContain("cp .release-tooling/scripts/giga-smoke.mjs scripts/giga-smoke.mjs");
    expect(workflow).toContain(
      "cp .release-tooling/test/e2e/mixed-federation.spec.ts test/e2e/mixed-federation.spec.ts",
    );
    expect(workflow).toContain(
      "grep -q reactFromLoadShare examples/mixed-federation/host-vite/src/bootstrap.tsx",
    );
    expect(workflow).toContain("examples/mixed-federation-issues");
    expect(workflow).toContain("examples/nested-federation");
    expect(workflow).toContain("examples/compatibility/vite-nitro-react");
    expect(workflow).toMatch(/sparse-checkout:\s*\|\s*\n\s+scripts\n\s+test\/e2e\n/);
    const pinReleaseJob = workflow.slice(
      workflow.indexOf("  pin-release:"),
      workflow.indexOf("  verify:"),
    );
    const verifyJob = workflow.slice(workflow.indexOf("  verify:"), workflow.indexOf("  stage:"));
    const stageJob = workflow.slice(
      workflow.indexOf("  stage:"),
      workflow.indexOf("  promote-github-release:"),
    );

    expect(pinReleaseJob).toContain("git ls-remote --exit-code --tags origin");
    expect(pinReleaseJob).toContain('"refs/tags/${TAG}^{}"');
    expect(pinReleaseJob).toContain('REMOTE_COMMIT="$(printf');
    expect(pinReleaseJob).toContain('test "$REMOTE_COMMIT" = "$CHECKED_OUT_COMMIT"');
    expect(pinReleaseJob).toContain('echo "oid=${CHECKED_OUT_COMMIT}"');
    expect(verifyJob).toContain("ref: ${{ needs.pin-release.outputs.oid }}");
    expect(verifyJob).not.toContain("ref: ${{ github.event.release.tag_name || inputs.tag }}");
    expect(verifyJob).toContain("cache: false");
    expect(verifyJob).toContain("name: Pack the verified npm artifact");
    expect(verifyJob).toContain("if: matrix.node-version == 26");
    expect(verifyJob).toContain("sha256sum package.tgz release-tag release-sha");
    expect(verifyJob).toContain("actions/upload-artifact@");
    // CodeQL treats needs.<job>.outputs.<field> as a PR HEAD checkout when
    // the job id or field matches head|sha|commit|branch|ref.
    expect("pin-release").not.toMatch(/head|sha|commit|branch|ref/i);
    expect("oid").not.toMatch(/head|sha|commit|branch|ref/i);
    expect(stageJob).toContain("actions/download-artifact@");
    expect(stageJob).toContain("name: verified-npm-package");
    expect(stageJob).toContain("actions: read");
    expect(stageJob).toContain("id-token: write");
    expect(stageJob).toContain("sha256sum --check SHA256SUMS");
    expect(stageJob).toContain("EXPECTED_TAG");
    expect(stageJob).toContain("EXPECTED_SHA");
    expect(stageJob).toContain("tar -xOf release-package/package.tgz package/package.json");
    expect(stageJob).toContain("npm stage publish release-package/package.tgz");
    expect(stageJob).not.toContain("actions/checkout@");
    expect(stageJob).not.toContain("ref: ${{ needs.pin-release.outputs.oid }}");
    expect(stageJob).not.toContain(".release-tooling");
    expect(stageJob).not.toContain("setup-vp");
    expect(stageJob).not.toContain("release:dry-run");
    expect(stageJob).not.toContain("ref: ${{ github.event.release.tag_name || inputs.tag }}");
    expect(workflow).toContain("description: Existing plain-semver tag");
    expect(workflow).not.toContain("description: Branch or plain semver tag");
    expect(workflow).toContain('test "${TAG}" = "${VERSION}"');
    expect(workflow).toContain('git tag --points-at HEAD --list "${TAG}"');
    expect(stageJob).toContain("Install npm for staged publishing");
    expect(stageJob).toContain('npm config set prefix "$HOME/.local"');
    expect(stageJob).toContain('echo "$HOME/.local/bin" >> "$GITHUB_PATH"');
    expect(stageJob).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(stageJob).toContain("npm install --global npm@11.17.0");
    expect(stageJob).toContain('test "$(npm --version)" = "11.17.0"');
    expect(stageJob).not.toContain("sudo ");
    expect(stageJob).not.toContain("/usr/local");
    const installNpm = stageJob.indexOf("npm install --global npm@11.17.0");
    expect(installNpm).toBeGreaterThan(-1);
    expect(installNpm).toBeLessThan(stageJob.indexOf("npm view"));
    expect(installNpm).toBeLessThan(stageJob.indexOf("npm stage publish"));
    expect(workflow).toContain("node-version: [22, 24, 26]");
    expect(workflow).toContain("vp run pack:check && vp run test:e2e");
    expect(workflow).not.toContain("vp run check");
    expect(workflow).toContain("id-token: write");
    expect(workflow.indexOf("id-token: write")).toBeGreaterThan(workflow.indexOf("stage:"));
    expect(workflow).toContain("environment: npm");
    expect(workflow).toContain("package-exists:");
    expect(workflow).toContain("First-package bootstrap required");
    expect(workflow).toContain("if: needs.pin-release.outputs.package-exists == 'true'");
    expect(workflow).toContain("npm stage publish release-package/package.tgz --access public");
    expect(workflow).not.toMatch(/run:\s+npm publish(?!\s+--dry-run)/);
    expect(workflow).not.toContain("NPM_TOKEN");
  });

  it("keeps GitHub Releases draft until npm stage succeeds", async () => {
    const create = await readFile(".github/workflows/create-release.yml", "utf8");
    const publish = await readFile(".github/workflows/publish-on-release.yml", "utf8");
    const releaseFiles = await readFile(".github/workflows/release-files.yml", "utf8");

    expect(create).toContain("--draft");
    expect(create).toContain(
      'args=("$VERSION" --draft --verify-tag --generate-notes --title "MFDoctor $VERSION")',
    );
    expect(create).not.toContain("--draft=false");
    expect(create.indexOf('git tag --annotate "$VERSION"')).toBeLessThan(create.indexOf("--draft"));
    expect(create).toContain('gh workflow run release-files.yml --ref main -f "tag=$VERSION"');
    expect(create).toContain('gh workflow run publish-on-release.yml --ref main -f "tag=$VERSION"');

    expect(publish).toContain("types: [published]");
    expect(publish).toContain("workflow_dispatch:");
    expect(publish).toContain(
      "github.event_name != 'release' || github.actor != 'github-actions[bot]'",
    );
    expect(publish).toContain("promote-github-release:");
    expect(publish).toContain("needs: [pin-release, stage]");
    expect(publish).toContain('gh release edit "$TAG" --draft=false');
    expect(publish.indexOf("promote-github-release:")).toBeGreaterThan(publish.indexOf("stage:"));
    expect(publish.indexOf('gh release edit "$TAG" --draft=false')).toBeGreaterThan(
      publish.indexOf("npm stage publish"),
    );
    expect(publish.indexOf("contents: write")).toBeGreaterThan(
      publish.indexOf("promote-github-release:"),
    );
    expect(
      publish.slice(publish.indexOf("stage:"), publish.indexOf("promote-github-release:")),
    ).not.toContain("contents: write");
    const promoteJob = publish
      .slice(publish.indexOf("promote-github-release:"))
      .split("bootstrap-notice:")[0];
    expect(promoteJob).not.toContain("if: always()");
    expect(promoteJob).not.toMatch(/^\s+if:/m);

    expect(releaseFiles).toContain("workflow_dispatch:");
    expect(releaseFiles).toContain("gh release upload");
    expect(releaseFiles).toContain("types: [published]");
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
    expect(workflow).toContain("--draft");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain('gh workflow run release-files.yml --ref main -f "tag=$VERSION"');
    expect(workflow).toContain(
      'gh workflow run publish-on-release.yml --ref main -f "tag=$VERSION"',
    );
    expect(workflow).not.toMatch(/(?:pnpm|npm) publish/);
  });
});
