import { readFileSync } from "node:fs";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import starlightLlmsTxt from "starlight-llms-txt";
import { SITE_BASE, SITE_URL, type SidebarEntry } from "./src/prebuild/index.ts";

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
  integrations: [
    starlight({
      title: "seampact",
      description: SITE_DESCRIPTION,
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/jubasse/seampact" }],
      sidebar,
      plugins: [starlightLinksValidator(), starlightLlmsTxt({ projectName: "seampact" })],
    }),
  ],
});
