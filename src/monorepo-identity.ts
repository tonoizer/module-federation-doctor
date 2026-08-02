import path from "node:path";
import {
  createApplicationIdentity,
  unknownIdentity,
  type ApplicationIdentity,
} from "./identity.js";

function relativeWorkspacePath(projectRoot: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, projectRoot).split(path.sep).join("/");
  return relative || ".";
}

/** Return the app directory that owns `.mf/doctor/project.json`. */
export function workspaceProjectRoot(file: string): string {
  return path.dirname(path.dirname(path.dirname(path.resolve(file))));
}

export function workspaceRootForProjects(projectRoots: string[]): string {
  const normalized = projectRoots.map((root) => path.resolve(root));
  if (normalized.length === 0) return process.cwd();
  const first = normalized[0]!.split(path.sep);
  let length = first.length;
  for (const root of normalized.slice(1)) {
    const parts = root.split(path.sep);
    while (
      length > 0 &&
      first.slice(0, length).join(path.sep) !== parts.slice(0, length).join(path.sep)
    )
      length -= 1;
  }
  return first.slice(0, Math.max(length, 1)).join(path.sep) || path.parse(normalized[0]!).root;
}

/** Build a stable app identity while keeping unknown organization explicit. */
export function createWorkspaceApplicationIdentity(
  name: string,
  projectRoot: string,
  workspaceRoot: string,
): ApplicationIdentity {
  const organization = unknownIdentity("organization", "workspace");
  const relativeRoot = relativeWorkspacePath(projectRoot, workspaceRoot);
  return createApplicationIdentity(
    { organizationId: "unknown", applicationId: `${name}:${relativeRoot}` },
    {
      parentKey: organization.key,
      completeness: "partial",
      confidence: "weak",
      provenance: { source: "unknown", evidenceIds: [] },
      displayName: name,
    },
  );
}
