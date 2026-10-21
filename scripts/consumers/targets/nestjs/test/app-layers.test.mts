// Boots the consumer case of an app's own NestJS layers (`src/app-layers-module.mts`) and checks what each layer
// observes around the generated boundary: the order of guards, interceptors and pipes against the contract's checks,
// and that the reply on a contract route stays the contract's, in the reply mode the consumer was generated with.
import "reflect-metadata";
import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as TasksNest from "../generated/server/tasks/index.js";
import {
  APP_FILTER_STATUS,
  APP_JWT_SECRET,
  AppLayersModule,
  appLayerEvents,
  MAPPED_BY_APP,
  openAppRequestStore,
  useAppInterceptors,
} from "../src/app-layers-module.mjs";
import { REPLY_MODE } from "../src/reply-mode.mjs";
import { loadScriptReply } from "../src/suite-control.mjs";
import { USER_ID } from "./credentials.mjs";

const HOST = "127.0.0.1";
const CHANNEL = "11111111-1111-4111-8111-111111111111";
const TASK = "44444444-4444-4444-8444-444444444444";
const INTERNAL_STATUS = 500;

let app: NestExpressApplication;
let baseUrl: string;

// An HS256 JWT the app's passport strategy accepts, for the given subject.
function appJwt(subject: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: subject })}`;
  const signature = createHmac("sha256", APP_JWT_SECRET).update(unsigned).digest("base64url");

  return `${unsigned}.${signature}`;
}

const SIGNED_IN = { authorization: `Bearer ${appJwt(USER_ID)}` };

async function send(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();

  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

function portOf(address: AddressInfo | string | null): number {
  if (address === null || typeof address === "string") {
    throw new Error(`The app layers case listens on ${String(address)}, not on a TCP port.`);
  }

  return address.port;
}

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppLayersModule, {
    rawBody: true,
    logger: false,
  });
  app.useBodyParser("json", { strict: false, limit: TasksNest.LARGEST_BODY_LIMIT });
  app.use(openAppRequestStore);
  useAppInterceptors(app);
  await app.listen(0, HOST);
  baseUrl = `http://${HOST}:${portOf(app.getHttpServer().address())}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  loadScriptReply({});
  appLayerEvents.length = 0;
});

describe("app guards", () => {
  test("a passport refusal at the global guard answers the api's 401 before any contract step", async () => {
    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks`);

    expect(reply.status).toBe(401);
    expect(reply.body).toMatchObject({ code: "api.unauthenticated" });
    expect(appLayerEvents).toEqual([]);
  });

  test("the authenticate hook sees the principal the passport strategy validated", async () => {
    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks`, { headers: SIGNED_IN });

    expect(reply.status).toBe(200);
    expect(appLayerEvents.slice(0, 2)).toEqual([`passport ${USER_ID}`, `authenticate ${USER_ID}`]);
  });

  test("a route guard above or below the composite runs before the seampact guard", async () => {
    const above = await send("GET", "/v1/channels", { headers: SIGNED_IN });
    const aboveEvents = appLayerEvents.splice(0);
    const below = await send("GET", `/v1/channels/${CHANNEL}`, { headers: SIGNED_IN });
    const belowEvents = appLayerEvents.splice(0);
    const refused = await send("GET", "/v1/channels");

    expect([above.status, below.status, refused.status]).toEqual([200, 200, 401]);
    // One passport run each: the route guard's, the global guard skipping both methods by the app's marker.
    expect(aboveEvents.slice(0, 2)).toEqual([`passport ${USER_ID}`, `authenticate ${USER_ID}`]);
    expect(belowEvents.slice(0, 2)).toEqual([`passport ${USER_ID}`, `authenticate ${USER_ID}`]);
  });

  test("the app's public marker below the composite skips its global guard", async () => {
    const reply = await send("GET", "/v1/health");

    expect(reply.status).toBe(200);
    expect(appLayerEvents.filter((event) => event.startsWith("passport"))).toEqual([]);
  });
});

describe("app interceptors and pipes", () => {
  test("app interceptors run after the access checks, around the input checks", async () => {
    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks`, { headers: SIGNED_IN });

    expect(reply.status).toBe(200);
    expect(appLayerEvents).toEqual([
      `passport ${USER_ID}`,
      `authenticate ${USER_ID}`,
      "interceptor before listTasks",
      "pipe custom",
      // In the handler mode the reply is written before the interceptors' post-phase.
      `interceptor after ${REPLY_MODE === "handler" ? "undefined" : "[object Object]"}`,
    ]);
  });

  test("a response-transforming interceptor maps the reply in the interceptor mode only", async () => {
    const reply = await send("GET", "/v1/health");

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(REPLY_MODE === "handler" ? { status: "ok" } : MAPPED_BY_APP);
  });

  test("a schemaInvalid refusal passes through an app interceptor's catchError and answers the contract's 400", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: { ...SIGNED_IN, "idempotency-key": randomUUID() },
      body: { title: "", unknownMember: true },
    });

    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ code: "api.schema_invalid" });
    expect(appLayerEvents.slice(0, 4)).toEqual([
      `passport ${USER_ID}`,
      `authenticate ${USER_ID}`,
      "interceptor before createTask",
      "pipe custom",
    ]);
    expect(appLayerEvents[4]).toMatch(/^interceptor error ContractError/);
    expect(appLayerEvents).toHaveLength(5);
  });

  test("the app's ValidationPipe with validateCustomDecorators leaves the contract input untouched", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: { ...SIGNED_IN, "idempotency-key": randomUUID() },
      body: { title: "Plan the release", effort: 2 },
    });

    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ title: "Plan the release" });
    expect(appLayerEvents).toContain("pipe custom");
  });
});

describe("app filters", () => {
  test("an app filter's undeclared status still becomes the contract's 500", async () => {
    loadScriptReply({ answers: { "tasks.getTask": { throws: "handler failure" } } });

    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
      headers: SIGNED_IN,
    });

    expect(reply.status).not.toBe(APP_FILTER_STATUS);
    expect(reply.status).toBe(INTERNAL_STATUS);
    expect(appLayerEvents).toContain("interceptor error Error handler failure");
    expect(appLayerEvents).toContain("filter Error handler failure");
  });
});
