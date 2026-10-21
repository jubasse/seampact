// The hand-written NestJS server on Express: one controller with a method per contract route, the framework's
// decorators for the params, query, headers and body, `rawBody` on for the signed route, the logger off.
import "reflect-metadata";
import type { AddressInfo } from "node:net";
import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
// The consumer overlay's, which the bench project is assembled on.
import { useBenchAppInterceptor } from "../../../src/bench-app-interceptor.mjs";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { type BaselineReply, type BaselineRequest, runBaselineRoute } from "../route-work.mjs";

const HOST = "127.0.0.1";
const BODY_LIMIT_BYTES = 2_097_152;

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

interface IncomingRequest {
  readonly url: string;
  readonly rawBody?: Buffer;
}

interface OutgoingResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

// Runs the baseline route, sets the status on the passthrough response and returns the body for Nest to send.
async function reply(
  routeId: string,
  response: OutgoingResponse,
  request: BaselineRequest,
): Promise<unknown> {
  const answer: BaselineReply = await runBaselineRoute(routeId, request);

  response.status(answer.status);

  for (const [name, value] of Object.entries(answer.headers ?? {})) response.setHeader(name, value);

  return answer.body;
}

type PathFields = Record<string, string>;
type TextFields = Record<string, string | undefined>;

@Controller()
class BaselineController {
  @Get("v1/health")
  health(
    @Query() query: TextFields,
    @Headers() headers: TextFields,
    @Req() request: IncomingRequest,
    @Res({ passthrough: true }) response: OutgoingResponse,
  ) {
    return reply("health", response, {
      path: {},
      query,
      headers,
      body: undefined,
      url: request.url,
    });
  }

  @Get("v1/channels/:channelId")
  getChannel(
    @Param() path: PathFields,
    @Query() query: TextFields,
    @Headers() headers: TextFields,
    @Req() request: IncomingRequest,
    @Res({ passthrough: true }) response: OutgoingResponse,
  ) {
    return reply("getChannel", response, {
      path,
      query,
      headers,
      body: undefined,
      url: request.url,
    });
  }

  @Get("v1/channels/:channelId/tasks")
  listTasks(
    @Param() path: PathFields,
    @Query() query: TextFields,
    @Headers() headers: TextFields,
    @Req() request: IncomingRequest,
    @Res({ passthrough: true }) response: OutgoingResponse,
  ) {
    return reply("listTasks", response, {
      path,
      query,
      headers,
      body: undefined,
      url: request.url,
    });
  }

  @Post("v1/channels/:channelId/tasks")
  createTask(
    @Param() path: PathFields,
    @Query() query: TextFields,
    @Headers() headers: TextFields,
    @Body() body: unknown,
    @Req() request: IncomingRequest,
    @Res({ passthrough: true }) response: OutgoingResponse,
  ) {
    return reply("createTask", response, { path, query, headers, body, url: request.url });
  }

  @Patch("v1/channels/:channelId/tasks/:taskId")
  updateTask(
    @Param() path: PathFields,
    @Query() query: TextFields,
    @Headers() headers: TextFields,
    @Body() body: unknown,
    @Req() request: IncomingRequest,
    @Res({ passthrough: true }) response: OutgoingResponse,
  ) {
    return reply("updateTask", response, { path, query, headers, body, url: request.url });
  }

  @Post("v1/hooks/payments")
  payments(
    @Query() query: TextFields,
    @Headers() headers: TextFields,
    @Body() body: unknown,
    @Req() request: IncomingRequest,
    @Res({ passthrough: true }) response: OutgoingResponse,
  ) {
    return reply("payments", response, {
      path: {},
      query,
      headers,
      body,
      rawBody: request.rawBody,
      url: request.url,
    });
  }
}

@Module({ controllers: [BaselineController] })
class BaselineModule {}

export async function startServer(): Promise<RunningServer> {
  const app = await NestFactory.create<NestExpressApplication>(BaselineModule, {
    rawBody: true,
    logger: ["error", "warn"],
  });

  app.useBodyParser("json", { strict: false, limit: BODY_LIMIT_BYTES });
  useBenchAppInterceptor(app);
  await app.listen(0, HOST);

  return {
    baseUrl: `http://${HOST}:${portOf(app.getHttpServer().address())}`,
    close: () => app.close(),
  };
}

function portOf(address: AddressInfo | string | null): number {
  if (address === null || typeof address === "string") {
    throw new Error(`The NestJS baseline listens on ${String(address)}, not on a TCP port.`);
  }

  return address.port;
}
