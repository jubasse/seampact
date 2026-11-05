# @seampact/docs-site

The documentation website, built with Starlight from the repository's `docs/` folder, the one source of the docs. Private, never published.

- `pnpm --filter @seampact/docs-site build` writes the site to `dist/`; `dev` serves it with live reload, `preview` serves the built `dist/`.
- The build first copies `docs/` into `site/content/docs/` (git-ignored): each page's first heading becomes its title, relative links become site routes, and links to files outside the site become GitHub links on `develop`. The sidebar follows the sections of `docs/README.md`.
- The build fails on a link to a missing page, file or anchor.
- `docs/agents/` and `docs/conformance/` stay out of the site: they are for contributors.
- Edit the pages in `docs/`, never in `site/content/docs/`.
