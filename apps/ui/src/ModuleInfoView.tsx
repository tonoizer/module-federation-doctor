import type { ProjectFacts } from "./types";

export function ModuleInfoView({ projects }: { projects: ProjectFacts[] }) {
  if (projects.length === 0)
    return (
      <section className="panel">
        <h2>Module info</h2>
        <p className="muted">No projects in this report.</p>
      </section>
    );

  return (
    <section className="modules">
      {projects.map((project) => {
        const mf = project.moduleFederation;
        return (
          <article key={project.project.name} className="module-card">
            <h3>{project.project.name}</h3>
            <dl>
              <dt>Federation</dt>
              <dd>{mf?.name ?? "(none)"}</dd>
              <dt>Bundler</dt>
              <dd>
                {project.bundler.name}
                {project.bundler.version ? ` ${project.bundler.version}` : ""}
              </dd>
              <dt>Exposes</dt>
              <dd>{Object.keys(mf?.exposes ?? {}).join(", ") || "(none)"}</dd>
              <dt>Remotes</dt>
              <dd>{Object.keys(mf?.remotes ?? {}).join(", ") || "(none)"}</dd>
              <dt>Shared</dt>
              <dd>{Object.keys(mf?.shared ?? {}).join(", ") || "(none)"}</dd>
              <dt>Runtime</dt>
              <dd>
                {mf?.experiments?.provideExternalRuntime
                  ? "provides external runtime"
                  : mf?.experiments?.externalRuntime
                    ? "consumes external runtime"
                    : "bundled"}
              </dd>
            </dl>
          </article>
        );
      })}
    </section>
  );
}
