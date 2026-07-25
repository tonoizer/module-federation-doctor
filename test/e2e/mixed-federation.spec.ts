import { expect, test } from "@playwright/test";

test("renders both federation remotes without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByTestId("rspack-remote")).toContainText("Direct Rspack remote");
  await expect(page.getByTestId("rsbuild-remote")).toContainText("Rsbuild remote");
  expect(errors).toEqual([]);
});
