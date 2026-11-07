# @seampact/docs-site

The documentation website, built with Starlight from the repository's `docs/` folder, the one source of the docs. Private, never published.

- `pnpm --filter @seampact/docs-site build` writes the site to `dist/`; `dev` serves it with live reload, `preview` serves the built `dist/`.
- The build first copies `docs/` into `site/content/docs/` (git-ignored): each page's first heading becomes its title, relative links become site routes, and links to files outside the site become GitHub links on `develop`. The sidebar follows the sections of `docs/README.md`.
- The build fails on a link to a missing page, file or anchor.
- `docs/agents/` and `docs/conformance/` stay out of the site: they are for contributors.
- Edit the pages in `docs/`, never in `site/content/docs/`.
- The home page is `home/index.mdx`, site-only; `docs/README.md` is the first sidebar entry, at `/documentation/`. Contributor pages (`adr/`, `ir/`, `decisions`, `design-decisions`, `roadmap`) are out of search; the three moved pages are redirects (`MOVED_PAGES` in `src/prebuild/page-policy.ts`).
- The logo is `site/assets/logo.svg`, copied to `public/favicon.svg` (with `public/favicon.ico`); `public/og.png` is rendered from `site/assets/og-card.svg` with headless Chrome. Replace the files to rebrand.
- Search Console and Bing verification: add the token at the commented hook in `astro.config.ts`.
