import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  FEDERATION_SERVERS,
  ISSUE_FEDERATION_SERVERS,
  waitForFederationServers,
} from "./helpers/federation-servers";

const repository = path.resolve(import.meta.dirname, "../..");

type DoctorReport = {
  findings: Array<{ ruleId: string; severity: string; evidence?: Record<string, unknown> }>;
};

async function readReport(relativeDirectory: string): Promise<DoctorReport> {
  return JSON.parse(
    await fs.readFile(path.join(repository, relativeDirectory, ".mf/doctor/report.json"), "utf8"),
  ) as DoctorReport;
}

test.describe("mixed-federation green path", () => {
  test.beforeEach(async ({ request }) => {
    await waitForFederationServers(request);
  });

  test("renders both federation remotes without browser errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(
      page.getByTestId("remote-loading"),
      `host (${FEDERATION_SERVERS[2].entryUrl}) remotes did not finish loading`,
    ).toBeHidden({ timeout: 15_000 });

    await expect(
      page.getByTestId("rspack-remote"),
      `rspack remote (${FEDERATION_SERVERS[0].entryUrl}) did not render`,
    ).toContainText("Direct Rspack remote");
    await expect(
      page.getByTestId("rsbuild-remote"),
      `rsbuild remote (${FEDERATION_SERVERS[1].entryUrl}) did not render`,
    ).toContainText("Rsbuild remote");

    expect(errors, "browser console errors while loading remotes").toEqual([]);

    for (const directory of [
      "examples/mixed-federation/host-vite",
      "examples/mixed-federation/remote-rspack",
      "examples/mixed-federation/remote-rsbuild",
    ]) {
      const report = await readReport(directory);
      const ruleIds = report.findings.map((finding) => finding.ruleId);
      expect(ruleIds, `${directory} should stay quiet for observability nudges`).not.toContain(
        "config/observability-plugin-recommended",
      );
      expect(ruleIds, `${directory} should stay quiet for prefix-share nudges`).not.toContain(
        "shared/prefix-share-recommended",
      );
    }
  });
});

test.describe("mixed-federation intentional findings path", () => {
  test("exposes the intentional shared-runtime incompatibility", async ({ page, request }) => {
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });

    for (const server of ISSUE_FEDERATION_SERVERS) {
      const response = await request.get(server.entryUrl);
      expect(response.ok(), `${server.entryUrl} did not serve during negative runtime smoke`).toBe(
        true,
      );
    }

    const hostReport = await readReport("examples/mixed-federation-issues/host-vite");
    expect(hostReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "shared/prefix-share-recommended",
          severity: "error",
          evidence: expect.objectContaining({
            package: "react-dom",
            specifiers: ["react-dom/client"],
          }),
        }),
      ]),
    );

    await page.goto(ISSUE_FEDERATION_SERVERS[2].url);
    await expect
      .poll(() => browserErrors.join(" | "), {
        timeout: 15_000,
        message: "the intentional React shared-version mismatch did not surface at runtime",
      })
      .toContain("ReactCurrentDispatcher");
  });
});
