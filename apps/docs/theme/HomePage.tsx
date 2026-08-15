import { useLang, usePage, useSite, withBase } from "@rspress/core/runtime";

const startLinks = [
  {
    href: "/setup",
    title: "Get started",
    detail: "Install MFDoctor, run the first build, and gate the whole workspace.",
  },
  {
    href: "/integrations",
    title: "Choose a bundler integration",
    detail: "Copy the setup for Vite, Nuxt, Rspack, Rsbuild, Webpack, or Modern.js.",
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
          title: "Erste Schritte",
          detail:
            "MFDoctor installieren, den ersten Build ausführen und den gesamten Workspace absichern.",
        },
        {
          href: "/integrations",
          title: "Bundler-Integration auswählen",
          detail: "Einrichtung für Vite, Nuxt, Rspack, Rsbuild, Webpack oder Modern.js übernehmen.",
        },
        {
          href: "/rules/",
          title: "Regelreferenz durchsuchen",
          detail:
            "Erfahren, was jeder Befund schützt, warum er wichtig ist und wie er behoben wird.",
        },
        {
          href: "/examples",
          title: "Beispiel öffnen",
          detail:
            "Funktionierende Vite-, Rspack-, Rsbuild-, Webpack- und Mixed-Federation-Setups nachvollziehen.",
        },
      ]
    : startLinks;
  const localizedProjectLinks = isGerman
    ? [
        {
          href: "/compatibility",
          title: "Bundler-Kompatibilität",
          meta: "Vite · Rspack · Rsbuild · Webpack · Modern.js · Nuxt",
        },
        {
          href: "/production-readiness",
          title: "Produktionsbereitschaft",
          meta: "CI-Richtlinie · Unterdrückungen · Baselines · SARIF",
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
                Beginnen Sie mit der <a href={localizeHref("/setup")}>Einrichtungsanleitung</a> oder
                sehen Sie sich den vollständigen <a href={localizeHref("/rules/")}>Regelkatalog</a>{" "}
                an.
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
                MFDoctor runs in Node after emit and adds nothing to the browser bundle. Start with
                the <a href={localizeHref("/setup")}>setup guide</a>, or review the full{" "}
                <a href={localizeHref("/rules/")}>rule catalog</a>.
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
