import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  ADAPTER_FIXTURES,
  MULTI_INSTANCE_FIXTURES,
  expectDoctorReport,
  expectDoctorInstanceScope,
  runMatrixRuntime,
  type MatrixFixture,
} from "./helpers/multi-instance";

async function expectEntryAssets(
  request: APIRequestContext,
  fixture: MatrixFixture,
): Promise<void> {
  for (const instance of fixture.instances) {
    const url = `${fixture.baseUrl}${instance.entry}`;
    const response = await request.get(url);
    expect(response.status(), `${fixture.name} entry ${url}`).toBe(200);
  }
}

for (const fixture of MULTI_INSTANCE_FIXTURES) {
  test(`${fixture.name} executes two independent federation containers`, async ({
    page,
    request,
  }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

    expectDoctorReport(fixture);
    expectDoctorInstanceScope(fixture);
    await expectEntryAssets(request, fixture);
    await page.goto(`${fixture.baseUrl}/`);
    await runMatrixRuntime(page, fixture);

    await expect(page.getByTestId("multi-instance-runtime")).toHaveAttribute(
      "data-status",
      "passed",
    );
    await expect(page.getByTestId("multi-instance-ready")).toHaveAttribute("data-status", "passed");
    for (const instance of fixture.instances) {
      const output = page.getByTestId(`multi-instance-${instance.name}`);
      await expect(output).toHaveAttribute("data-status", "passed");
      await expect(output).toHaveText(instance.expectedValue);
    }

    expect(browserErrors, `${fixture.name} browser errors`).toEqual([]);
  });
}

for (const fixture of ADAPTER_FIXTURES) {
  test(`${fixture.name} serves its production container and keeps one model scope`, async ({
    page,
    request,
  }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

    expectDoctorReport(fixture);
    expectDoctorInstanceScope(fixture);
    await expectEntryAssets(request, fixture);
    await page.goto(`${fixture.baseUrl}/`);
    await runMatrixRuntime(page, fixture);

    await expect(page.getByTestId("multi-instance-runtime")).toHaveAttribute(
      "data-status",
      "passed",
    );
    await expect(page.getByTestId("multi-instance-adapter")).toHaveText(instanceValue(fixture));
    expect(browserErrors, `${fixture.name} browser errors`).toEqual([]);
  });
}

function instanceValue(fixture: (typeof ADAPTER_FIXTURES)[number]): string {
  return fixture.instances[0]!.expectedValue;
}
