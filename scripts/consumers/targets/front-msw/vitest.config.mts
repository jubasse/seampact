// The MSW consumer's Vitest projects, with no server: a node project running the generated fetch client against
// the generated handlers under `setupServer`, and a browser project on Playwright Chromium running the same cases
// under `setupWorker`, whose worker script this config serves from the installed msw at the page's root.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import type { Vite } from "vitest/node";

const WORKER_ROUTE = "/mockServiceWorker.js";
const workerFile = createRequire(import.meta.url).resolve("msw/mockServiceWorker.js");

export default defineConfig({
  test: {
    projects: [
      { test: { name: "node", include: ["test/msw/**/*.test.mts"] } },
      {
        plugins: [serveWorkerScript()],
        test: {
          name: "front",
          include: ["test/front/**/*.browser.test.mts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});

// The app would copy the script with `msw init`; serving it from the installed package keeps it at the msw version.
function serveWorkerScript(): Vite.Plugin {
  return {
    name: "seampact:msw-worker-script",
    configureServer(server) {
      server.middlewares.use(WORKER_ROUTE, (_request, response) => {
        response.setHeader("content-type", "text/javascript");
        response.end(readFileSync(workerFile, "utf8"));
      });
    },
  };
}
