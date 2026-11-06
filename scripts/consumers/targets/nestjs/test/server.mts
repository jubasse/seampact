// Boots the NestJS app on Express around the generated boundaries of each api, as the docs' setup with
// `rawBody: true` shows, on a free local port.
import "reflect-metadata";
import type { AddressInfo } from "node:net";
import { type ArgumentsHost, Catch } from "@nestjs/common";
import { BaseExceptionFilter, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import * as TasksNest from "../generated/server/tasks/index.js";
import * as TasksDevicesNest from "../generated/server/tasksDevices/index.js";
import * as TasksPagingNest from "../generated/server/tasksPaging/index.js";
import * as TasksServiceNest from "../generated/server/tasksService/index.js";
import * as TasksServiceWritesNest from "../generated/server/tasksServiceWrites/index.js";
import { useBenchAppInterceptor } from "../src/bench-app-interceptor.mjs";
import { MISMATCHED_MOUNT, mountsUnderMismatchedPrefix } from "../src/boot-variant.mjs";
import { ConsumerModule } from "../src/consumer-module.mjs";

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";

// One global filter for every api: each api's helper first, then NestJS's default for the app's own routes.
@Catch()
class PreRoutingFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (TasksNest.renderPreRoutingError(exception, host)) return;

    if (TasksServiceNest.renderPreRoutingError(exception, host)) return;

    if (TasksServiceWritesNest.renderPreRoutingError(exception, host)) return;

    if (TasksDevicesNest.renderPreRoutingError(exception, host)) return;

    if (TasksPagingNest.renderPreRoutingError(exception, host)) return;

    super.catch(exception, host);
  }
}

export async function startServer(): Promise<RunningServer> {
  const app = await NestFactory.create<NestExpressApplication>(ConsumerModule, {
    rawBody: true,
    logger: ["error", "warn"],
  });

  app.useBodyParser("json", {
    strict: false,
    limit: Math.max(
      TasksNest.LARGEST_BODY_LIMIT,
      TasksServiceNest.LARGEST_BODY_LIMIT,
      TasksServiceWritesNest.LARGEST_BODY_LIMIT,
      TasksDevicesNest.LARGEST_BODY_LIMIT,
      TasksPagingNest.LARGEST_BODY_LIMIT,
    ),
  });
  app.useGlobalFilters(new PreRoutingFilter(app.getHttpAdapter()));

  if (mountsUnderMismatchedPrefix()) app.setGlobalPrefix(MISMATCHED_MOUNT);

  useBenchAppInterceptor(app);
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
