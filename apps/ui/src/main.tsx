import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import type { DoctorUiPayload } from "./types";

const empty: DoctorUiPayload = {
  schemaVersion: 1,
  report: {
    schemaVersion: 1,
    capabilities: {},
    summary: { projects: 0, info: 0, warnings: 0, errors: 0 },
    findings: [],
  },
  projects: [],
  graphs: {
    remotes: { nodes: [], edges: [] },
    shared: { nodes: [], edges: [] },
    orchestration: { nodes: [], edges: [] },
  },
};

const payload = window["__MF_DOCTOR_UI__"] ?? empty;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App payload={payload} />
  </StrictMode>,
);
