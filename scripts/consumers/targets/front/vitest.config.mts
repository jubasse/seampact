// The front consumer's Vitest projects: a browser project on Playwright Chromium for `test/front`, and, when the base
// overlay provides a server entry (`test/server.mts`), the node project of the server's own tests. With a server,
// the config starts it before Vite reads `server.proxy`, proxies the apis' base paths and the control routes to it,
// so the page calls the api on its own origin, and provides its URL and the credentials to the browser tests.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HOOK_CALLS_ROUTE, SCRIPT_ROUTE } from "@seampact/http-suite";
import { playwright } from "@vitest/browser-playwright";
import { tsImport } from "tsx/esm/api";
import { defineConfig, type TestProjectInlineConfiguration } from "vitest/config";
import type { Vite } from "vitest/node";
import { THROTTLE_RETRY_AFTER_MS, THROTTLED_USER_TOKEN, USER_TOKEN } from "./test/credentials.mjs";
import "./test/front/provided.mjs";

const SERVER_ENTRY = new URL("./test/server.mts", import.meta.url);

// The paths the page sends to the server: the base paths of the reference contract (`fixtures/reference`, copied into
// every consumer) and the http suite's control routes. A contract with another base path needs its path added here.
const PROXIED_PATHS = ["^/v1/", "^/internal/", "^/__seampact/"];

interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const server = existsSync(SERVER_ENTRY) ? await startProvidedServer() : undefined;

export default defineConfig({
  plugins: server === undefined ? [] : [closeOnVitestClose(server)],
  test: {
    projects: [...nodeProjects(), browserProject(server)],
  },
});

function nodeProjects(): TestProjectInlineConfiguration[] {
  if (server === undefined) return [];

  return [{ test: { name: "node", include: ["test/**/*.test.mts"], exclude: ["test/front/**"] } }];
}

function browserProject(running: RunningServer | undefined): TestProjectInlineConfiguration {
  return {
    server: running === undefined ? {} : { proxy: proxyTo(running.baseUrl) },
    test: {
      name: "front",
      include: ["test/front/**/*.browser.test.{mts,tsx}"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
      },
      provide: {
        serverBaseUrl: running?.baseUrl ?? "",
        controlRoutes: { script: SCRIPT_ROUTE, hookCalls: HOOK_CALLS_ROUTE },
        userToken: USER_TOKEN,
        throttledUserToken: THROTTLED_USER_TOKEN,
        throttleRetryAfterMs: THROTTLE_RETRY_AFTER_MS,
      },
    },
  };
}

function proxyTo(target: string): Record<string, { target: string; changeOrigin: boolean }> {
  return Object.fromEntries(PROXIED_PATHS.map((path) => [path, { target, changeOrigin: true }]));
}

// The base overlay's server entry imports the generated `.js` specifiers of `.ts` files, which tsx resolves.
async function startProvidedServer(): Promise<RunningServer> {
  const entry: unknown = await tsImport(fileURLToPath(SERVER_ENTRY), import.meta.url);

  if (!isServerEntry(entry)) {
    throw new Error(`front: ${fileURLToPath(SERVER_ENTRY)} must export startServer().`);
  }

  return entry.startServer();
}

function isServerEntry(value: unknown): value is { startServer(): Promise<RunningServer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "startServer" in value &&
    typeof value.startServer === "function"
  );
}

function closeOnVitestClose(running: RunningServer): Vite.Plugin {
  return {
    name: "seampact:close-front-server",
    configureVitest({ vitest }) {
      vitest.onClose(() => running.close());
    },
  };
}
