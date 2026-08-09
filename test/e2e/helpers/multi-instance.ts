import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export type RuntimeInstance = {
  name: string;
  identity: string;
  entry: string;
  fileName: string;
  expose: string;
  expectedValue: string;
  container?: string;
  artifactFiles?: readonly string[];
};

export type MatrixFixture = {
  name: string;
  bundler: "webpack" | "vite" | "rspack" | "rsbuild";
  projectPath: string;
  baseUrl: string;
  entryKind: "global" | "module";
  instances: readonly RuntimeInstance[];
};

type MatrixCell = {
  id: string;
  fixture: string;
  bundler: MatrixFixture["bundler"];
  runtime?: {
    label: string;
    port: number;
    entryKind: MatrixFixture["entryKind"];
    instances: readonly RuntimeInstance[];
  };
};

const compatibilityMatrix = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "fixtures/compatibility-matrix.json"), "utf8"),
) as { localCi: readonly MatrixCell[] };
const localMatrix = compatibilityMatrix.localCi;

function matrixFixture(id: string): MatrixFixture {
  const cell = localMatrix.find((candidate) => candidate.id === id);
  if (!cell?.runtime) throw new Error(`Missing runtime contract for compatibility cell ${id}`);
  return {
    name: cell.runtime.label,
    bundler: cell.bundler,
    projectPath: cell.fixture,
    baseUrl: `http://127.0.0.1:${cell.runtime.port}`,
    entryKind: cell.runtime.entryKind,
    instances: cell.runtime.instances,
  };
}

/** Frameworks with a production plugin that can emit two containers in one config. */
const runtimeFixtures = localMatrix
  .filter((cell) => cell.runtime)
  .map((cell) => matrixFixture(cell.id));

export const MULTI_INSTANCE_FIXTURES = runtimeFixtures.filter(
  (fixture) => fixture.instances.length > 1,
);

/** Adapter cells that keep the supported single-plugin Rspack/Rsbuild contract covered. */
export const ADAPTER_FIXTURES = runtimeFixtures.filter((fixture) => fixture.instances.length === 1);

export const ALL_MATRIX_FIXTURES = [...MULTI_INSTANCE_FIXTURES, ...ADAPTER_FIXTURES] as const;

type JsonRecord = Record<string, any>;

function readDoctorProject(fixture: MatrixFixture): JsonRecord {
  const projectFile = path.resolve(process.cwd(), fixture.projectPath, ".mf/doctor/project.json");
  expect(fs.existsSync(projectFile), `${fixture.name} Doctor project is missing`).toBe(true);
  return JSON.parse(fs.readFileSync(projectFile, "utf8")) as JsonRecord;
}

function projectInstances(project: JsonRecord): JsonRecord[] {
  if (Array.isArray(project.federationInstances)) return project.federationInstances;
  return project.moduleFederation ? [project] : [];
}

function assetNames(instance: JsonRecord): string[] {
  const assets = instance.artifacts?.emittedAssets;
  return Array.isArray(assets) ? assets.map(String) : [];
}

function readDoctorReport(fixture: MatrixFixture): JsonRecord {
  const reportFile = path.resolve(process.cwd(), fixture.projectPath, ".mf/doctor/report.json");
  expect(fs.existsSync(reportFile), `${fixture.name} Doctor report is missing`).toBe(true);
  return JSON.parse(fs.readFileSync(reportFile, "utf8")) as JsonRecord;
}

/** Assert the production build itself completed without Doctor errors. */
export function expectDoctorReport(fixture: MatrixFixture): void {
  const report = readDoctorReport(fixture);
  expect(report.summary?.errors, `${fixture.name} Doctor errors`).toBe(0);
}

/** Assert instance identity and artifact ownership, not just that a browser page rendered. */
export function expectDoctorInstanceScope(fixture: MatrixFixture): void {
  const project = readDoctorProject(fixture);
  const instances = projectInstances(project);
  expect(instances, `${fixture.name} Doctor instance count`).toHaveLength(fixture.instances.length);

  if (fixture.instances.length > 1) {
    const ids = instances
      .map((instance) => instance.id)
      .filter((id): id is string => typeof id === "string");
    expect(new Set(ids).size, `${fixture.name} instance identities`).toBe(fixture.instances.length);
  }

  for (const expected of fixture.instances) {
    const instance = instances.find(
      (candidate) => candidate.moduleFederation?.name === expected.identity,
    );
    expect(instance, `${fixture.name} missing instance ${expected.name}`).toBeTruthy();
    if (!instance) continue;
    const assets = assetNames(instance);
    const ownEntry = assets.find(
      (asset) => asset.endsWith(`/${expected.fileName}`) || asset === expected.fileName,
    );
    expect(ownEntry, `${fixture.name} ${expected.name} remote entry ownership`).toBeTruthy();
    const expectedIdentity = expected.identity;
    expect(
      instance.artifacts?.manifest?.name ?? instance.artifacts?.manifest?.id,
      `${fixture.name} ${expected.name} manifest identity`,
    ).toBe(expectedIdentity);
    if (expected.artifactFiles?.some((file) => file.endsWith("mf-stats.json"))) {
      const statsData = instance.artifacts?.stats?.data;
      expect(
        statsData?.name ?? statsData?.id,
        `${fixture.name} ${expected.name} stats identity`,
      ).toBe(expectedIdentity);
    }
    for (const artifactFile of expected.artifactFiles ?? []) {
      expect(
        assets.some((asset) => asset.endsWith(`/${artifactFile}`) || asset === artifactFile),
        `${fixture.name} ${expected.name} must own ${artifactFile}`,
      ).toBe(true);
    }

    for (const other of fixture.instances) {
      if (other === expected) continue;
      expect(
        assets.some((asset) => asset.endsWith(`/${other.fileName}`) || asset === other.fileName),
        `${fixture.name} ${expected.name} must not own ${other.fileName}`,
      ).toBe(false);
      for (const artifactFile of other.artifactFiles ?? []) {
        expect(
          assets.some((asset) => asset.endsWith(`/${artifactFile}`) || asset === artifactFile),
          `${fixture.name} ${expected.name} must not own ${artifactFile}`,
        ).toBe(false);
      }
    }
  }
}

/** Load global and ESM federation containers through one browser-side contract. */
export async function runMatrixRuntime(page: Page, fixture: MatrixFixture): Promise<void> {
  await page.evaluate(() => {
    document.body.innerHTML =
      '<main data-testid="multi-instance-runtime" data-status="pending"><output data-testid="multi-instance-ready" data-status="pending"></output></main>';
  });

  await page.evaluate(async (input) => {
    const outputId = (instance: RuntimeInstance): string => `multi-instance-${instance.name}`;
    const root = document.querySelector<HTMLElement>('[data-testid="multi-instance-runtime"]');
    const ready = document.querySelector<HTMLOutputElement>('[data-testid="multi-instance-ready"]');
    if (!root || !ready) throw new Error("multi-instance harness is incomplete");

    for (const instance of input.instances) {
      const output = document.createElement("output");
      output.dataset.testid = outputId(instance);
      output.dataset.status = "pending";
      root.appendChild(output);
    }

    const loadGlobalContainer = (instance: RuntimeInstance): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `${input.baseUrl}${instance.entry}`;
        script.addEventListener("load", () => {
          const container = instance.container
            ? Reflect.get(window, instance.container)
            : undefined;
          if (!container) reject(new Error(`Missing global container ${instance.container}`));
          else resolve(container);
        });
        script.addEventListener("error", () => reject(new Error(`Failed to load ${script.src}`)));
        document.head.appendChild(script);
      });

    type Container = {
      init: (scope: unknown) => Promise<unknown> | unknown;
      get: (expose: string) => Promise<() => unknown>;
    };

    const loadContainer = async (instance: RuntimeInstance): Promise<unknown> => {
      if (input.entryKind === "module") return import(`${input.baseUrl}${instance.entry}`);
      return loadGlobalContainer(instance);
    };

    try {
      // Loading and initialization in parallel catches shared-global collisions
      // that sequential smoke tests would hide.
      const containers = (await Promise.all(input.instances.map(loadContainer))) as Container[];
      const shareScopes = Reflect.get(window, "__webpack_share_scopes__");
      const shareScope =
        shareScopes && (typeof shareScopes === "object" || typeof shareScopes === "function")
          ? (Reflect.get(shareScopes, "default") ?? {})
          : {};
      await Promise.all(
        containers.map((container) => {
          if (
            !container ||
            typeof container.init !== "function" ||
            typeof container.get !== "function"
          )
            throw new Error("Loaded value is not a Module Federation container");
          return container.init(shareScope);
        }),
      );

      const values = await Promise.all(
        containers.map(async (container, index) => {
          const instance = input.instances[index]!;
          const factory = await container.get(instance.expose);
          const exposed = await factory();
          const defaultValue =
            exposed && (typeof exposed === "object" || typeof exposed === "function")
              ? Reflect.get(exposed, "default")
              : undefined;
          const value =
            typeof defaultValue === "function" ? defaultValue() : (defaultValue ?? exposed);
          const output = document.querySelector<HTMLOutputElement>(
            `[data-testid="${outputId(instance)}"]`,
          );
          if (!output) throw new Error(`Missing output for ${instance.name}`);
          output.dataset.status = "passed";
          output.dataset.container = instance.container ?? instance.name;
          output.value = String(value);
          output.textContent = String(value);
          return String(value);
        }),
      );

      for (const [index, value] of values.entries()) {
        if (value !== input.instances[index]!.expectedValue)
          throw new Error(`Unexpected value for ${input.instances[index]!.name}: ${value}`);
      }
      ready.dataset.status = "passed";
      ready.value = values.join(",");
      ready.textContent = values.join(",");
      root.dataset.status = "passed";
    } catch (error) {
      root.dataset.status = "failed";
      ready.dataset.status = "failed";
      ready.value = error instanceof Error ? error.message : String(error);
      ready.textContent = ready.value;
      throw error;
    }
  }, fixture);
}
