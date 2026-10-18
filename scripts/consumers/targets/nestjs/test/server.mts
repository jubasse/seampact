// Boots the NestJS app on Express around the generated boundaries of both apis, as the docs' setup with
// `rawBody: true` shows, on a free local port.
import "reflect-metadata";
import type { AddressInfo } from "node:net";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ConsumerModule } from "../src/consumer-module.mjs";
import * as TasksNest from "../generated/server/tasks/index.js";
import * as TasksServiceNest from "../generated/server/tasksService/index.js";

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";

export async function startServer(): Promise<RunningServer> {
  const app = await NestFactory.create<NestExpressApplication>(ConsumerModule, {
    rawBody: true,
    logger: ["error", "warn"],
  });

  app.useBodyParser("json", {
    limit: Math.max(TasksNest.LARGEST_BODY_LIMIT, TasksServiceNest.LARGEST_BODY_LIMIT),
  });
  app.useGlobalFilters(TasksNest.preRoutingFilter);
  await app.listen(0, HOST);

  return {
    baseUrl: `http://${HOST}:${portOf(app.getHttpServer().address())}`,
    close: () => app.close(),
  };
}

function portOf(address: AddressInfo | string | null): number {
  if (address === null || typeof address === "string") {
    throw new Error(`The NestJS app listens on ${String(address)}, not on a TCP port.`);
  }

  return address.port;
}
