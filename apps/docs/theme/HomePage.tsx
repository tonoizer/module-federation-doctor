import { useLang, usePage, useSite, withBase } from "@rspress/core/runtime";

const startLinks = [
  {
    href: "/setup",
    title: "Setup",
    detail: "Install MFDoctor, add a bundler adapter, and run the first check.",
  },
  {
    href: "/production-readiness",
    title: "CI",
    detail: "Gate builds with fail-on-error, SARIF, workspace checks, and baselines.",
  },
  {
    href: "/rules/",
    title: "Rules",
    detail: "See what each finding protects, why it matters, and how to fix it.",
  },
  {
    href: "/limitations",
    title: "Limitations",
    detail: "Know the supported surface, honest gaps, and permanent non-goals.",
  },
];

const projectLinks = [
  {
    href: "/integrations",
    title: "Bundler integrations",
    meta: "Vite · Rspack · Rsbuild · Webpack · Modern.js · Nuxt",
  },
  {
    href: "/compatibility",
    title: "Bundler compatibility",
    meta: "Supported · partial · CI evidence",
  },
  {
    href: "/examples",
    title: "Examples",
    meta: "Working hosts, remotes, and mixed federation setups",
  },
  {
    href: "https://github.com/tonoizer/module-federation-doctor",
    title: "Source on GitHub",
    meta: "Issues · contribution guide · changelog",
    external: true,
  },
];

function ProjectRow({
  href,
  title,
  detail,
  meta,
  external = false,
  localizeHref,
}: {
  href: string;
  title: string;
  detail?: string;
  meta?: string;
  external?: boolean;
  localizeHref: (href: string) => string;
}) {
  return (
    <a
      className="kb-row"
      href={external ? href : localizeHref(href)}
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
  const lang = useLang();
  const { page } = usePage();
  const { site } = useSite();
  const isGerman = lang === "de";
  const hasVersions = site.multiVersion.versions.length > 0;
  const versionPrefix =
    hasVersions && page.version !== site.multiVersion.default ? `/${page.version}` : "";
  const languagePrefix = isGerman ? "/de" : "";
  const localizeHref = (href: string) => {
    if (/^(?:https?:|mailto:|#)/.test(href)) return href;
    return withBase(`${versionPrefix}${languagePrefix}${href}`);
  };

  const localizedStartLinks = isGerman
    ? [
        {
          href: "/setup",
          title: "Einrichtung",
          detail:
            "MFDoctor installieren, einen Bundler-Adapter hinzufügen und die erste Prüfung ausführen.",
        },
        {
          href: "/production-readiness",
          title: "CI",
          detail: "Builds mit fail-on-error, SARIF, Workspace-Prüfungen und Baselines absichern.",
        },
        {
          href: "/rules/",
          title: "Regeln",
          detail:
            "Erfahren, was jeder Befund schützt, warum er wichtig ist und wie er behoben wird.",
        },
        {
          href: "/limitations",
          title: "Einschränkungen",
          detail: "Unterstützte Fläche, ehrliche Lücken und dauerhafte Nicht-Ziele kennen.",
        },
      ]
    : startLinks;
  const localizedProjectLinks = isGerman
    ? [
        {
          href: "/integrations",
          title: "Bundler-Integrationen",
          meta: "Vite · Rspack · Rsbuild · Webpack · Modern.js · Nuxt",
        },
        {
          href: "/compatibility",
          title: "Bundler-Kompatibilität",
          meta: "Supported · partial · CI-Nachweise",
        },
        {
          href: "/examples",
          title: "Beispiele",
          meta: "Funktionierende Hosts, Remotes und Mixed-Federation-Setups",
        },
        {
          href: "https://github.com/tonoizer/module-federation-doctor",
          title: "Quellcode auf GitHub",
          meta: "Issues · Beitragsleitfaden · Changelog",
          external: true,
        },
      ]
    : projectLinks;

  return (
    <main className="kb-home">
      <section className="kb-intro">
        <h1>MFDoctor</h1>
        <div className="kb-copy">
          {isGerman ? (
            <>
              <p>
                <code>@tonoizer/mfdoctor</code> ist ein Diagnosewerkzeug nach dem Build für
                Module-Federation-Projekte. Es findet Probleme in Konfiguration, Sharing,
                Manifesten, Laufzeit und Ausgabe, solange der Build noch genügend Belege für eine
                Erklärung enthält.
              </p>
              <p>
                Registrieren Sie MFDoctor neben Ihrem Federation-Plugin. Erfolgreiche Builds bleiben
                ruhig; Befunde enthalten eine Regel, Auswirkungen, einen Lösungsvorschlag und einen
                direkten Dokumentationslink. Fehler lassen die CI erst scheitern, nachdem alle
                Befunde gesammelt wurden.
              </p>
              <p>
                MFDoctor läuft nach der Ausgabe in Node und fügt dem Browser-Bundle nichts hinzu.
                Beginnen Sie mit <a href={localizeHref("/setup")}>Einrichtung</a>,{" "}
                <a href={localizeHref("/production-readiness")}>CI</a>, dem{" "}
                <a href={localizeHref("/rules/")}>Regelkatalog</a> und den{" "}
                <a href={localizeHref("/limitations")}>Einschränkungen</a>.
              </p>
            </>
          ) : (
            <>
              <p>
                <code>@tonoizer/mfdoctor</code> is a post-build diagnostic tool for Module
                Federation projects. It finds configuration, sharing, manifest, runtime, and output
                problems while the build still has enough evidence to explain them.
              </p>
              <p>
                Register MFDoctor next to your federation plugin. Clean builds stay quiet; findings
                include a rule, impact, suggested fix, and a direct documentation link. Errors fail
                CI only after every finding has been collected.
              </p>
              <p>
                MFDoctor runs in Node after emit and adds nothing to the browser bundle. Start with{" "}
                <a href={localizeHref("/setup")}>Setup</a>,{" "}
                <a href={localizeHref("/production-readiness")}>CI</a>, the{" "}
                <a href={localizeHref("/rules/")}>rule catalog</a>, and{" "}
                <a href={localizeHref("/limitations")}>Limitations</a>.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="kb-section">
        <h2>{isGerman ? "Einstieg" : "Start"}</h2>
        <div className="kb-list">
          {localizedStartLinks.map((item) => (
            <ProjectRow key={item.href} {...item} localizeHref={localizeHref} />
          ))}
        </div>
        {isGerman ? (
          <p className="kb-note">
            Bibliotheksautorinnen und -autoren, die Doctor erweitern: Identity-, Waiver-, Graph- und
            Capture-Verträge stehen unter{" "}
            <a href={localizeHref("/capabilities#library-contracts-110")}>
              Bibliothek / Erweiterung
            </a>
            .
          </p>
        ) : (
          <p className="kb-note">
            Extending Doctor as a library author? Identity, waivers, graph, and capture contracts
            live under{" "}
            <a href={localizeHref("/capabilities#library-contracts-110")}>Library / extension</a>.
          </p>
        )}
      </section>

      <section className="kb-section">
        <h2>{isGerman ? "Projekt" : "Project"}</h2>
        <div className="kb-list">
          {localizedProjectLinks.map((item) => (
            <ProjectRow key={item.href} {...item} localizeHref={localizeHref} />
          ))}
        </div>
        {isGerman ? (
          <p className="kb-note">
            Inspiriert von der Diagnosetiefe von <a href="https://rsdoctor.rs/">Rsdoctor</a> und dem
            fokussierten Workflow von <a href="https://www.react.doctor/">React Doctor</a>,
            angepasst für Module Federation.
          </p>
        ) : (
          <p className="kb-note">
            Inspired by the diagnostic depth of <a href="https://rsdoctor.rs/">Rsdoctor</a> and the
            focused workflow of <a href="https://www.react.doctor/">React Doctor</a>, adapted for
            Module Federation.
          </p>
        )}
      </section>
    </main>
  );
}
