import { expect, test } from "@playwright/test";
import { waitForFederationServers } from "./helpers/federation-servers";

test.describe("mixed-federation green path", () => {
  test.beforeEach(async () => {
    await waitForFederationServers();
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
      "host (http://localhost:5173) remotes did not finish loading",
    ).toBeHidden({ timeout: 15_000 });

    await expect(
      page.getByTestId("rspack-remote"),
      "rspack remote (http://localhost:3001/remoteEntry.js) did not render",
    ).toContainText("Direct Rspack remote");
    await expect(
      page.getByTestId("rsbuild-remote"),
      "rsbuild remote (http://localhost:3002/remoteEntry.js) did not render",
    ).toContainText("Rsbuild remote");

    expect(errors, "browser console errors while loading remotes").toEqual([]);
  });
});
