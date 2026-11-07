import { readFileSync } from "node:fs";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import {
  movedPageRedirects,
  SITE_BASE,
  SITE_URL,
  type SidebarEntry,
} from "./src/prebuild/index.ts";

const SHARE_CARD_URL = `${SITE_URL}${SITE_BASE}og.png`;
const SITE_DESCRIPTION =
  "Declare your API once in YAML. Get typed handlers, validators, OpenAPI and clients for your own framework.";

// Written by the prebuild from docs/README.md; `pnpm build` runs the prebuild first.
const sidebar: SidebarEntry[] = JSON.parse(
  readFileSync(new URL("./site/generated/sidebar.json", import.meta.url), "utf8"),
);

export default defineConfig({
  // The site's own sources sit apart from src/, which holds the prebuild.
  srcDir: "./site",
  site: SITE_URL,
  base: SITE_BASE,
  // The moved pages are redirects, not pages: they are in no sitemap.
  redirects: movedPageRedirects(),
  prefetch: { prefetchAll: true },
  integrations: [
    starlight({
      title: "seampact",
      description: SITE_DESCRIPTION,
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/jubasse/seampact" }],
      logo: {
        src: "./site/assets/logo.svg",
        // The site title beside it already says the name.
        alt: "",
      },
      favicon: "/favicon.svg",
      customCss: ["./site/custom.css"],
      lastUpdated: true,
      head: [
        { tag: "link", attrs: { rel: "icon", href: `${SITE_BASE}favicon.ico`, sizes: "any" } },
        { tag: "meta", attrs: { property: "og:image", content: SHARE_CARD_URL } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: SHARE_CARD_URL } },
        { tag: "script", attrs: { src: `${SITE_BASE}focusable-tables.js`, defer: true } },
        // Search Console and Bing verification: add the token the user gets here, then submit sitemap-index.xml.
        // { tag: "meta", attrs: { name: "google-site-verification", content: "<token>" } },
        // { tag: "meta", attrs: { name: "msvalidate.01", content: "<token>" } },
      ],
      sidebar,
      plugins: [starlightLinksValidator()],
    }),
  ],
});
