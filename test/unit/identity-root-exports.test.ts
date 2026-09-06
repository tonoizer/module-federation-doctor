import { describe, expect, it } from "vitest";
import * as identity from "../../src/identity.js";
import * as root from "../../src/index.js";

describe("identity root exports", () => {
  it("keeps engine/CLI identity helpers on `.`", () => {
    expect(root.createApplicationIdentity).toBe(identity.createApplicationIdentity);
    expect(root.unknownIdentity).toBe(identity.unknownIdentity);
    expect(root.IDENTITY_SCHEMA_VERSION).toBe(identity.IDENTITY_SCHEMA_VERSION);
    expect(root.IdentityValidationError).toBe(identity.IdentityValidationError);
    expect(root.IDENTITY_SCHEMA_VERSION).toBe(1);
  });

  it("leaves unused identity factories on src/identity.ts only", () => {
    expect(root).not.toHaveProperty("canonicalIdentityKey");
    expect(root).not.toHaveProperty("createAdapterTargetIdentity");
    expect(root).not.toHaveProperty("createArtifactIdentity");
    expect(root).not.toHaveProperty("createBuildIdentity");
    expect(root).not.toHaveProperty("createBuildLineageIdentity");
    expect(root).not.toHaveProperty("createContainerIdentity");
    expect(root).not.toHaveProperty("createDeploymentIdentity");
    expect(root).not.toHaveProperty("createEnvironmentIdentity");
    expect(root).not.toHaveProperty("createIdentity");
    expect(root).not.toHaveProperty("createOrganizationIdentity");
    expect(root).not.toHaveProperty("createRuntimeInstanceIdentity");
    expect(root).not.toHaveProperty("createRuntimeRealmIdentity");

    expect(typeof identity.canonicalIdentityKey).toBe("function");
    expect(typeof identity.createAdapterTargetIdentity).toBe("function");
    expect(typeof identity.createArtifactIdentity).toBe("function");
    expect(typeof identity.createBuildIdentity).toBe("function");
    expect(typeof identity.createBuildLineageIdentity).toBe("function");
    expect(typeof identity.createContainerIdentity).toBe("function");
    expect(typeof identity.createDeploymentIdentity).toBe("function");
    expect(typeof identity.createEnvironmentIdentity).toBe("function");
    expect(typeof identity.createIdentity).toBe("function");
    expect(typeof identity.createOrganizationIdentity).toBe("function");
    expect(typeof identity.createRuntimeInstanceIdentity).toBe("function");
    expect(typeof identity.createRuntimeRealmIdentity).toBe("function");
  });
});
