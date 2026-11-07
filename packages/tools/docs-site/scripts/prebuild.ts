// Regenerates the site's content folder and sidebar from docs/ before each build.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSiteContent } from "../src/prebuild/index.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const summary = buildSiteContent(packageRoot);

console.log(
  `docs-site: ${summary.pageCount} pages written, folder indexes for ${summary.writtenFolderIndexes.join(", ")}, ${summary.agentFileCount} agent files.`,
);

if (summary.pagesOutsideSidebar.length > 0) {
  console.log(
    `docs-site: pages docs/README.md does not list, reachable by links only: ${summary.pagesOutsideSidebar.join(", ")}.`,
  );
}
