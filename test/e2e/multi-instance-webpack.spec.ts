import { expect, test } from "@playwright/test";

test.describe("multiple Module Federation instances", () => {
  test("executes both Webpack containers from one production build", async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

    await page.goto("http://127.0.0.1:3003/");

    await expect(page.getByTestId("multi-instance-runtime")).toHaveAttribute(
      "data-status",
      "passed",
    );
    await expect(page.getByTestId("multi-instance-checkout")).toHaveAttribute(
      "data-status",
      "passed",
    );
    await expect(page.getByTestId("multi-instance-checkout")).toHaveAttribute(
      "data-container",
      "webpack_smoke_checkout",
    );
    await expect(page.getByTestId("multi-instance-checkout")).toHaveText("webpack-smoke-widget");

    await expect(page.getByTestId("multi-instance-catalog")).toHaveAttribute(
      "data-status",
      "passed",
    );
    await expect(page.getByTestId("multi-instance-catalog")).toHaveAttribute(
      "data-container",
      "webpack_smoke_catalog",
    );
    await expect(page.getByTestId("multi-instance-catalog")).toHaveText("webpack-smoke-catalog");
    await expect(page.getByTestId("multi-instance-ready")).toHaveAttribute("data-status", "passed");

    expect(browserErrors, "browser errors while executing both containers").toEqual([]);
  });
});
