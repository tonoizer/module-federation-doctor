import { expect, test } from "@playwright/test";
import { htmlReport } from "../../src/html.js";
import type { DoctorReport } from "../../src/types.js";

test("filters and searches the portable report without network requests", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const report: DoctorReport = {
    schemaVersion: 1,
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: true,
      stats: false,
      emittedAssets: true,
      installedVersions: true,
    },
    summary: { projects: 1, errors: 1, warnings: 1, info: 0 },
    findings: [
      {
        schemaVersion: 1,
        ruleId: "config/name-required",
        severity: "error",
        message: "Federation name is missing.",
        project: "host",
        evidence: {},
        suggestion: "Set a stable name.",
        fingerprint: "error-fingerprint",
      },
      {
        schemaVersion: 1,
        ruleId: "performance/version-first-startup",
        severity: "warning",
        message: "All remotes load during startup.",
        project: "host",
        evidence: { remotes: 4 },
        suggestion: "Use loaded-first.",
        fingerprint: "warning-fingerprint",
      },
    ],
  };

  await page.setContent(htmlReport(report));
  await expect(page.getByText("2 of 2 findings")).toBeVisible();
  await page.getByRole("button", { name: "Warnings" }).click();
  await expect(page.getByText("1 of 2 findings")).toBeVisible();
  await expect(page.getByText("performance/version-first-startup")).toBeVisible();
  await page.getByRole("button", { name: "All" }).click();
  await page.getByRole("searchbox").fill("missing");
  await expect(page.getByText("config/name-required")).toBeVisible();
  await expect(page.getByText("performance/version-first-startup")).toBeHidden();
  expect(requests).toEqual([]);
});
