export type Severity = "info" | "warning" | "error";

export interface DoctorFinding {
  schemaVersion: 1;
  ruleId: string;
  severity: Severity;
  message: string;
  project: string;
  location?: { path: string; line?: number; column?: number };
  evidence: Record<string, unknown>;
  suggestion?: string;
  documentation?: string;
  fingerprint: string;
}

export interface DoctorReport {
  schemaVersion: 1;
  capabilities: Record<string, boolean>;
  summary: {
    projects: number;
    info: number;
    warnings: number;
    errors: number;
  };
  findings: DoctorFinding[];
}

export type UiGraphNodeKind = "project" | "remote" | "shared" | "expose" | "runtime";

export interface UiGraphNode {
  id: string;
  label: string;
  kind: UiGraphNodeKind;
  project?: string;
  severity?: Severity;
  meta?: Record<string, unknown>;
}

export interface UiGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  severity?: Severity;
}

export interface UiGraph {
  nodes: UiGraphNode[];
  edges: UiGraphEdge[];
}

export interface ProjectFacts {
  schemaVersion: 1;
  project: { name: string; root: string };
  bundler: { name: string; version?: string; mode: string };
  moduleFederation?: {
    name?: string;
    exposes?: Record<string, string>;
    remotes?: Record<string, { name: string; entry: string; alias?: string }>;
    shared?: Record<
      string,
      {
        package: string;
        singleton: boolean;
        requiredVersion?: string | false;
        version?: string | false;
      }
    >;
    experiments?: {
      externalRuntime?: boolean;
      provideExternalRuntime?: boolean;
    };
  };
  dependencies: {
    declared: Record<string, string>;
    installed: Record<string, string>;
  };
}

export interface DoctorUiPayload {
  schemaVersion: 1;
  report: DoctorReport;
  projects: ProjectFacts[];
  graphs: {
    remotes: UiGraph;
    shared: UiGraph;
    orchestration: UiGraph;
  };
}

declare global {
  interface Window {
    __MF_DOCTOR_UI__?: DoctorUiPayload;
  }
}
