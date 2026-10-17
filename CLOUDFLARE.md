# Documentation hosting on Cloudflare

The GitHub repository remains `tonoizer/module-federation-doctor`. The canonical
documentation URL remains <https://mfdoctor.kevinbeier.com/>. The migration uses
Cloudflare Pages so this subdomain can move independently of the parent domain's
registrar, nameservers, email, and other applications.

## Production builds

Pages project: `mfdoctor`, production branch: `main`.

- Repository root: `/`
- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm build && pnpm docs:build && node scripts/check-cloudflare-docs.mjs`
- Output: `apps/docs/doc_build`
- Build environment: `NODE_VERSION=24`, `PNPM_VERSION=11.17.0`, `DOCS_BASE=/`,
  `SITE_ORIGIN=https://mfdoctor.kevinbeier.com`.

Connect the Cloudflare GitHub app to this repository and enable production
deployments from `main`. Keep automatic preview deployments disabled until their
access policy is configured: Vercel previously protected preview deployments.
Do not enable pull request comments unless wanted by the repository owner.
The existing GitHub Pages workflow is an independent fallback with
`DOCS_BASE=/module-federation-doctor/`; its artifact is unsuitable for the canonical
hostname, which needs the root base path.

`wrangler.jsonc` describes the Pages output and compatibility date. A local
`wrangler pages dev apps/docs/doc_build` can verify Pages URL and header behavior.
This site has no Pages Functions or runtime database bindings.

## Analytics and performance

Cloudflare Web Analytics is configured for `mfdoctor.kevinbeier.com` and enabled
through the Pages project's `web_analytics_tag` and `web_analytics_token` settings.
Pages inserts the beacon; do not add a second beacon to the Rspress layout.
These are public beacon identifiers, not API credentials. No API credentials are
committed to this repository.

Use **Cloudflare → Analytics & Logs → Web Analytics → mfdoctor.kevinbeier.com**
to inspect page views, visits, referrers, countries, devices and browsers,
page-load timings, and Core Web Vitals (LCP, INP, CLS). Rspress uses client-side
navigation; the beacon supports SPA measurement. Browser support, blockers,
sampling, and traffic volume affect the available measurements. LCP on soft
navigations depends on browser API support. Historical Vercel observations are
not imported into Cloudflare: retain/export available history separately before
removing Vercel. No Vercel Analytics or Speed Insights SDK was found in this
documentation application's package/configuration files during migration.

The Pages deployment dashboard provides build/deployment status. Zone-level DNS,
cache, and security analytics require the domain to be a Cloudflare zone; they
are not implied by moving only this Pages subdomain. No paid performance service
is required by this configuration.

Rspress generates static HTML and content-hashed JS/CSS/fonts. `_headers` gives
hashed assets a one-year immutable browser cache, adds security headers, and
marks Pages hostnames as `noindex`. Unversioned HTML, text, JSON, and public
images retain Pages' default revalidation behavior. Avoid a blanket cache rule
that pins HTML or documentation manifests in visitor browsers.

## Cutover and removal of Vercel

1. Get a successful Cloudflare build from the intended GitHub commit. Verify the
   Pages URL before changing DNS. Test the homepage, direct deep links, German,
   historical docs, search, downloads, real 404 responses, and slash redirects.
2. Add `mfdoctor.kevinbeier.com` under Pages **Custom domains** before editing DNS.
3. Add an explicit `mfdoctor CNAME mfdoctor.pages.dev` at the current DNS provider.
   The current Vercel wildcard also serves other applications; preserve it and
   all apex/email records. Do not change the parent nameservers for this cutover.
4. Wait for the Pages custom domain and TLS certificate to become active. Verify
   HTTPS, canonical URLs, response headers, compressed assets, and exactly one
   analytics beacon. Verify beacon delivery and subsequent dashboard data.
5. Verify an additional GitHub commit triggers a successful production build.
   Back up the Vercel project configuration and any available analytics history.
6. Remove the **mfdoctor.kevinbeier.com Vercel project only** after all checks pass.
   Its `*.vercel.app` URLs will then stop working. Do not delete `kevinbeier.com`
   from the team: Vercel still provides registrar/DNS services for it.

Before deleting Vercel, DNS rollback means removing the explicit `mfdoctor`
CNAME so the unchanged Vercel wildcard serves it again. Keep the Vercel domain
assignment/project intact until the cutover is verified. After deletion this
rollback requires recreating and deploying the Vercel project. Subsequent
Cloudflare rollbacks use a previous successful Pages production deployment.

See <https://developers.cloudflare.com/pages/configuration/custom-domains/>,
<https://developers.cloudflare.com/pages/configuration/headers/>, and
<https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/>.
