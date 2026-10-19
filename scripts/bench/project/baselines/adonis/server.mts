// The hand-written AdonisJS server: the app skeleton the consumer boots (Ignitor, bodyparser as router
// middleware, the logger at warn), the contract's routes added to its router as plain handlers. Runs on the
// AdonisJS major the consumer installs.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { Ignitor } from "@adonisjs/core";
import { defineConfig as defineBodyparserConfig } from "@adonisjs/core/bodyparser";
import { defineConfig as defineHttpConfig, type Router, type Server } from "@adonisjs/core/http";
import { defineConfig as defineLoggerConfig } from "@adonisjs/core/logger";
import { BASELINE_ROUTES, colonPath, runBaselineRoute } from "../route-work.mjs";

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";
const APP_KEY = "seampact-consumer-app-key-0123456789";
const ENCRYPTION_MODULE = "@adonisjs/core/encryption";
const FIRST_MAJOR_WITH_ENCRYPTION_CONFIG = 7;
const BODY_LIMIT = "2mb";
// The consumer root, the app root the generated server boots on as well.
const APP_ROOT = new URL("../../../", import.meta.url);

export async function startServer(): Promise<RunningServer> {
  const ignitor = new Ignitor(APP_ROOT, {
    importer: (path) => import(new URL(path, APP_ROOT).href),
  });
  const app = ignitor.createApp("web");

  app.rcContents({ providers: [() => import("@adonisjs/core/providers/app_provider")] });
  app.useConfig({
    app: { appKey: APP_KEY, http: defineHttpConfig({}) },
    logger: defineLoggerConfig({
      default: "app",
      loggers: { app: { enabled: true, name: "baseline", level: "warn" } },
    }),
    bodyparser: defineBodyparserConfig({
      allowedMethods: ["POST", "PUT", "PATCH", "DELETE"],
      json: { limit: BODY_LIMIT },
    }),
    ...(await encryptionConfig()),
  });
  await app.init();
  await app.boot();

  const router: Router = await app.container.make("router");
  const server: Server = await app.container.make("server");

  router.use([() => import("@adonisjs/core/bodyparser_middleware")]);
  addBaselineRoutes(router);
  await app.start(() => undefined);
  await server.boot();

  const nodeServer = createServer((request, response) => server.handle(request, response));

  await new Promise<void>((resolve) => nodeServer.listen(0, HOST, resolve));

  return {
    baseUrl: `http://${HOST}:${portOf(nodeServer.address())}`,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        nodeServer.close((error) => (error === undefined ? resolve() : reject(error))),
      );
      await app.terminate();
    },
  };
}

function addBaselineRoutes(router: Router): void {
  for (const [routeId, route] of Object.entries(BASELINE_ROUTES)) {
    router[route.method](colonPath(route.path), async ({ request, response }) => {
      const raw = request.raw();
      const reply = await runBaselineRoute(routeId, {
        path: request.params(),
        query: request.qs(),
        headers: request.headers(),
        body: raw === null || raw === "" ? undefined : request.body(),
        rawBody: raw === null ? undefined : Buffer.from(raw, "utf8"),
        url: request.url(true),
      });

      response.status(reply.status);

      for (const [name, value] of Object.entries(reply.headers ?? {})) response.header(name, value);

      return reply.body === undefined ? response.send(null) : reply.body;
    });
  }
}

// AdonisJS 7 refuses to boot without an encryption config; AdonisJS 6 has no `drivers` to write one with.
async function encryptionConfig(): Promise<Record<string, unknown>> {
  const manifest: unknown = createRequire(import.meta.url)("@adonisjs/core/package.json");
  const version: unknown =
    typeof manifest === "object" && manifest !== null
      ? Reflect.get(manifest, "version")
      : undefined;

  if (Number(String(version).split(".")[0]) < FIRST_MAJOR_WITH_ENCRYPTION_CONFIG) return {};

  const encryption: Record<string, unknown> = await import(ENCRYPTION_MODULE);
  const { defineConfig, drivers } = encryption;

  if (typeof defineConfig !== "function" || typeof drivers !== "object" || drivers === null) {
    throw new Error(
      `${ENCRYPTION_MODULE} has no defineConfig and drivers on AdonisJS ${String(version)}.`,
    );
  }

  const aes256gcm: unknown = Reflect.get(drivers, "aes256gcm");

  if (typeof aes256gcm !== "function") {
    throw new Error(`${ENCRYPTION_MODULE} has no aes256gcm driver on AdonisJS ${String(version)}.`);
  }

  return {
    encryption: defineConfig({
      default: "app",
      list: { app: aes256gcm({ id: "app", keys: [APP_KEY] }) },
    }),
  };
}

function portOf(address: AddressInfo | string | null): number {
  if (address === null || typeof address === "string") {
    throw new Error(`The AdonisJS baseline listens on ${String(address)}, not on a TCP port.`);
  }

  return address.port;
}
