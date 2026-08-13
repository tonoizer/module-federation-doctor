import { withBase } from "@rspress/core/runtime";

const startLinks = [
  {
    href: "/setup",
    title: "Install and configure",
    detail: "Add the build plugin next to Module Federation and run your normal build.",
  },
  {
    href: "/rules/",
    title: "Browse the rule reference",
    detail: "See what each finding protects, why it matters, and how to fix it.",
  },
  {
    href: "/examples",
    title: "Open an example",
    detail: "Follow working Vite, Rspack, Rsbuild, Webpack, and mixed-federation setups.",
  },
];

const projectLinks = [
  {
    href: "/compatibility",
    title: "Bundler compatibility",
    meta: "Vite · Rspack · Rsbuild · Webpack · Modern.js · Nuxt",
  },
  {
    href: "/production-readiness",
    title: "Production readiness",
    meta: "CI policy · suppressions · baselines · SARIF",
  },
  {
    href: "https://github.com/tonoizer/module-federation-doctor",
    title: "Source on GitHub",
    meta: "Issues · contributing · release history",
    external: true,
  },
];

function ProjectRow({
  href,
  title,
  detail,
  meta,
  external = false,
}: {
  href: string;
  title: string;
  detail?: string;
  meta?: string;
  external?: boolean;
}) {
  return (
    <a
      className="kb-row"
      href={external ? href : withBase(href)}
      rel={external ? "noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      <span>
        <strong>{title}</strong>
        {detail ? <span className="kb-row__detail">{detail}</span> : null}
        {meta ? <span className="kb-row__meta">{meta}</span> : null}
      </span>
      <span className="kb-row__arrow" aria-hidden="true">
        {external ? "↗" : "→"}
      </span>
    </a>
  );
}

export function HomePage() {
  return (
    <main className="kb-home">
      <section className="kb-intro">
        <h1>Module Federation Doctor</h1>
        <div className="kb-copy">
          <p>
            <code>@tonoizer/mfdoctor</code> is a post-build diagnostic tool for Module Federation
            projects. It finds configuration, sharing, manifest, runtime, and output problems while
            the build still has enough evidence to explain them.
          </p>
          <p>
            Register Doctor next to your federation plugin. Clean builds stay quiet; findings
            include a rule, impact, suggested fix, and a direct documentation link. Errors fail CI
            only after every finding has been collected.
          </p>
          <p>
            Doctor runs in Node after emit and adds nothing to the browser bundle. Start with the{" "}
            <a href={withBase("/setup")}>setup guide</a>, or review the full{" "}
            <a href={withBase("/rules/")}>rule catalog</a>.
          </p>
        </div>
      </section>

      <section className="kb-section">
        <h2>Start</h2>
        <div className="kb-list">
          {startLinks.map((item) => (
            <ProjectRow key={item.href} {...item} />
          ))}
        </div>
      </section>

      <section className="kb-section">
        <h2>Project</h2>
        <div className="kb-list">
          {projectLinks.map((item) => (
            <ProjectRow key={item.href} {...item} />
          ))}
        </div>
      </section>
    </main>
  );
}
