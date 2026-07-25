import { expect, test } from "@playwright/test";
import { htmlReport } from "../../src/html.js";
import { buildUiPayload } from "../../src/ui-graph.js";
import type { DoctorReport, ProjectFacts } from "../../src/types.js";

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

const project: ProjectFacts = {
  schemaVersion: 1,
  project: { name: "host", root: "." },
  bundler: { name: "vite", mode: "production" },
  capabilities: report.capabilities,
  moduleFederation: {
    name: "host",
    exposes: {},
    remotes: {
      remote: {
        name: "remote",
        entry: "http://localhost:3001/mf-manifest.json",
        shareScope: ["default"],
      },
    },
    shared: {
      react: {
        package: "react",
        singleton: true,
        eager: false,
        shareScope: ["default"],
      },
    },
  },
  dependencies: { declared: {}, installed: { react: "18.3.1" } },
  imports: { sourceFiles: [], specifiers: [], packages: [] },
  artifacts: { emittedAssets: [] },
};

test("filters and searches the portable report without network requests", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const payload = buildUiPayload([project], report);
  await page.setContent(htmlReport(payload));
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

test("shows remote and shared graph tabs from the UI payload", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.setContent(htmlReport(buildUiPayload([project], report)));
  await page.getByRole("tab", { name: "Remote graph" }).click();
  await expect(page.getByRole("heading", { name: "Remote graph" })).toBeVisible();
  await page.getByRole("tab", { name: "Shared" }).click();
  await expect(page.getByRole("heading", { name: /Shared/ })).toBeVisible();
  await page.getByRole("tab", { name: "Module info" }).click();
  await expect(page.getByText("Federation", { exact: true })).toBeVisible();
  await expect(page.getByText("host", { exact: true }).first()).toBeVisible();
  expect(requests).toEqual([]);
});
