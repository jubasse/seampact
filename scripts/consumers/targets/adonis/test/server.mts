// Boots the AdonisJS app around the generated boundaries of both apis, in process, on a free local port: the app
// is created with the Ignitor, its config passed in code (the consumer has no config directory), the bodyparser
// registered as router middleware, and the routes added once the app has booted, as a preloaded start/routes.ts
// adds them. Runs on the AdonisJS major the consumer installs.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { Ignitor } from "@adonisjs/core";
import { defineConfig as defineBodyparserConfig } from "@adonisjs/core/bodyparser";
import { defineConfig as defineHttpConfig, type Router, type Server } from "@adonisjs/core/http";
import { defineConfig as defineLoggerConfig } from "@adonisjs/core/logger";

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";
const APP_KEY = "seampact-consumer-app-key-0123456789";
const ENCRYPTION_MODULE = "@adonisjs/core/encryption";
const FIRST_MAJOR_WITH_ENCRYPTION_CONFIG = 7;
const APP_ROOT = new URL("../", import.meta.url);

export async function startServer(): Promise<RunningServer> {
  const ignitor = new Ignitor(APP_ROOT, {
    importer: (path) => import(new URL(path, APP_ROOT).href),
  });
  const app = ignitor.createApp("web");
  // The generated modules read the app service, so they load once the app exists.
  const TasksAdonis = await import("../generated/server/tasks/index.js");
  const TasksServiceAdonis = await import("../generated/server/tasksService/index.js");
  const { registerContractRoutes } = await import("../src/routes.mjs");

  app.rcContents({ providers: [() => import("@adonisjs/core/providers/app_provider")] });
  app.useConfig({
    app: { appKey: APP_KEY, http: defineHttpConfig({}) },
    logger: defineLoggerConfig({
      default: "app",
      loggers: { app: { enabled: true, name: "consumer", level: "warn" } },
    }),
    bodyparser: defineBodyparserConfig({
      allowedMethods: ["POST", "PUT", "PATCH", "DELETE"],
      json: {
        limit: Math.max(TasksAdonis.LARGEST_BODY_LIMIT, TasksServiceAdonis.LARGEST_BODY_LIMIT),
      },
    }),
    ...(await encryptionConfig()),
  });
  await app.init();
  await app.boot();

  const router: Router = await app.container.make("router");
  const server: Server = await app.container.make("server");

  router.use([() => import("@adonisjs/core/bodyparser_middleware")]);
  server.errorHandler(() => import("../src/exception-handler.mjs"));
  registerContractRoutes(router);
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
    throw new Error(`The AdonisJS app listens on ${String(address)}, not on a TCP port.`);
  }

  return address.port;
}
