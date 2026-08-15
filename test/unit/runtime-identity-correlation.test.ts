import { describe, expect, it } from "vitest";
import { projectRuntimeCaptureIdentity } from "../../src/runtime-identity-correlation.js";

const source = {
  captureId: "capture-1",
  realmId: "frame-1",
  runtimeVersion: "2.5.3",
  instanceName: "host",
};

describe("runtime capture identity projection", () => {
  it("projects explicit deployment, realm, and instance evidence exactly", () => {
    const result = projectRuntimeCaptureIdentity(source, {
      target: "browser",
      realm: "iframe",
      deploymentKey: "mfid:v1:deployment:0123456789abcdef01234567",
      environmentKey: "mfid:v1:environment:fedcba9876543210fedcba98",
      runtimeInstanceId: "instance-1",
      runtimePackage: "@module-federation/runtime",
    });
    expect(result.outcome).toBe("exact");
    expect(result.completeness).toBe("complete");
    expect(result.confidence).toBe("exact");
    expect(result.missing).toEqual([]);
    expect(result.scope).toEqual({
      target: "browser",
      realm: "iframe",
      environmentKey: "mfid:v1:environment:fedcba9876543210fedcba98",
    });
    expect(result.realm.parentKey).toBe(result.deploymentKey);
    expect(result.instance.parentKey).toBe(result.realm.key);
  });

  it("keeps absent deployment and instance facts as unknown source-scoped identities", () => {
    const result = projectRuntimeCaptureIdentity(source, {
      target: "browser",
      realm: "top-frame",
    });
    expect(result.outcome).toBe("strong");
    expect(result.completeness).toBe("partial");
    expect(result.missing).toEqual(["deploymentKey", "runtimeInstanceId", "runtimePackage"]);
    expect(result.deploymentKey).toMatch(/^mfid:v1:deployment:/);
    expect(result.instance.runtimeInstanceId).toBe("unknown");
    expect("instanceName" in result.instance).toBe(false);
  });

  it("does not turn a source-local name into runtime identity proof", () => {
    const result = projectRuntimeCaptureIdentity(
      { captureId: source.captureId, realmId: "unknown" },
      {
        target: "unknown",
        realm: "unknown",
        deploymentKey: "mfid:v1:deployment:0123456789abcdef01234567",
      },
    );
    expect(result.outcome).toBe("unknown");
    expect(result.instance.runtimeInstanceId).toBe("unknown");
    expect(result.instance.runtimePackage).toBe("unknown");
    expect(result.instance.runtimeVersion).toBe("unknown");
    expect(result.missing).toEqual([
      "realmId",
      "runtimeInstanceId",
      "runtimePackage",
      "runtimeVersion",
    ]);
  });

  it("rejects unsafe capture and reference identifiers", () => {
    expect(() =>
      projectRuntimeCaptureIdentity(
        { ...source, captureId: "https://secret.example/capture" },
        {
          target: "browser",
          realm: "top-frame",
        },
      ),
    ).toThrow();
    expect(() =>
      projectRuntimeCaptureIdentity(source, {
        target: "browser",
        realm: "top-frame",
        deploymentKey: "mfid:v1:environment:0123456789abcdef01234567",
      }),
    ).toThrow();
  });
});
