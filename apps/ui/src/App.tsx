import { useMemo, useState } from "react";
import type { DoctorUiPayload, Severity } from "./types";
import { FindingsView } from "./FindingsView";
import { GraphView } from "./GraphView";
import { ModuleInfoView } from "./ModuleInfoView";

type Tab = "findings" | "remotes" | "shared" | "orchestration" | "modules";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "findings", label: "Findings" },
  { id: "remotes", label: "Remote graph" },
  { id: "shared", label: "Shared" },
  { id: "orchestration", label: "Orchestration" },
  { id: "modules", label: "Module info" },
];

export function App({ payload }: { payload: DoctorUiPayload }) {
  const [tab, setTab] = useState<Tab>("findings");
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return payload.report.findings.filter(
      (finding) =>
        (filter === "all" || finding.severity === filter) &&
        (!needle ||
          [finding.ruleId, finding.project, finding.message, finding.suggestion ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(needle)),
    );
  }, [payload.report.findings, filter, query]);

  return (
    <main>
      <header>
        <div>
          <h1>Module Federation Doctor</h1>
          <p className="sub">Portable report. No network requests. No source bodies.</p>
        </div>
        <div>
          {tab === "findings"
            ? `${visible.length} of ${payload.report.findings.length} findings`
            : `${payload.projects.length} project(s)`}
        </div>
      </header>
      <section className="summary" aria-label="Finding summary">
        <div className="card">
          <span>Errors</span>
          <strong>{payload.report.summary.errors}</strong>
        </div>
        <div className="card">
          <span>Warnings</span>
          <strong>{payload.report.summary.warnings}</strong>
        </div>
        <div className="card">
          <span>Info</span>
          <strong>{payload.report.summary.info}</strong>
        </div>
      </section>
      <section className="tabs" role="tablist" aria-label="Dashboard views">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </section>
      {tab === "findings" ? (
        <FindingsView
          findings={visible}
          total={payload.report.findings.length}
          filter={filter}
          query={query}
          onFilter={setFilter}
          onQuery={setQuery}
        />
      ) : null}
      {tab === "remotes" ? <GraphView title="Remote graph" graph={payload.graphs.remotes} /> : null}
      {tab === "shared" ? (
        <GraphView title="Shared dependency graph" graph={payload.graphs.shared} />
      ) : null}
      {tab === "orchestration" ? (
        <GraphView title="Orchestration" graph={payload.graphs.orchestration} />
      ) : null}
      {tab === "modules" ? <ModuleInfoView projects={payload.projects} /> : null}
    </main>
  );
}
