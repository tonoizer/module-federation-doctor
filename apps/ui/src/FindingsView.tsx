import type { DoctorFinding, Severity } from "./types";

export function FindingsView({
  findings,
  total,
  filter,
  query,
  onFilter,
  onQuery,
}: {
  findings: DoctorFinding[];
  total: number;
  filter: "all" | Severity;
  query: string;
  onFilter: (value: "all" | Severity) => void;
  onQuery: (value: string) => void;
}) {
  return (
    <section>
      <section className="toolbar" aria-label="Report filters">
        {(
          [
            ["all", "All"],
            ["error", "Errors"],
            ["warning", "Warnings"],
            ["info", "Info"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            data-filter={value}
            aria-pressed={filter === value}
            onClick={() => onFilter(value)}
          >
            {label}
          </button>
        ))}
        <input
          type="search"
          placeholder="Search rules, projects, and messages"
          aria-label="Search findings"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </section>
      <section className="findings" aria-live="polite">
        {findings.length === 0 ? (
          <div className="empty">No findings match this view.</div>
        ) : (
          findings.map((finding) => (
            <article key={finding.fingerprint} className={`finding ${finding.severity}`}>
              <div className="row">
                <div>
                  <div className="rule">{finding.ruleId}</div>
                  <div className="sub">
                    {finding.project}
                    {finding.location ? ` · ${finding.location.path}` : ""}
                  </div>
                </div>
                <span className="severity">{finding.severity}</span>
              </div>
              <p className="message">{finding.message}</p>
              {finding.suggestion ? <p className="suggestion">Fix: {finding.suggestion}</p> : null}
              <details>
                <summary>Evidence</summary>
                <pre>{JSON.stringify(finding.evidence, null, 2)}</pre>
              </details>
              {finding.documentation ? (
                <a
                  href={`https://github.com/tonoizer/module-federation-doctor/blob/main/apps/docs/docs${finding.documentation}.md`}
                >
                  Rule documentation
                </a>
              ) : null}
            </article>
          ))
        )}
      </section>
      <p className="muted" hidden>
        {findings.length} of {total}
      </p>
    </section>
  );
}
