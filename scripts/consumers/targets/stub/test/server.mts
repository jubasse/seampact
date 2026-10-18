// The stub server of the `stub` overlay: a `node:http` server answering the reference operations as the
// contract declares them, with the honoured credentials, so the slice test checks the client and the packed
// installs without a server target. It proves the client only; each server target's own consumer is the proof.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { IdempotencyStore, SignedTemplateRequest } from "@seampact/hooks";
import { createMemoryIdempotencyStore } from "@seampact/idempotency-memory";
import { verifyTemplateSignature } from "@seampact/signed-webhooks";
import {
  SERVICE_JWT,
  STRIPE_KEY_ID,
  STRIPE_SECRET,
  THROTTLE_RETRY_AFTER_MS,
  THROTTLED_USER_TOKEN,
  USER_TOKEN,
} from "./credentials.mjs";

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

/** A search for this text answers after the operation's budget, so the client's timeout aborts it. */
export const SLOW_SEARCH_TEXT = "slow";

const SLOW_SEARCH_DELAY_MS = 1000;
const IDEMPOTENCY_LIFETIME_MS = 86_400_000;
const PREFERENCES_ETAG = '"preferences-1"';
const NEXT_CURSOR = "cursor-2";
const MILLISECONDS_PER_SECOND = 1000;
const PROBLEM_MEDIA = "application/problem+json";
const JSON_MEDIA = "application/json";

const STRIPE_TEMPLATE: SignedTemplateRequest["template"] = {
  algorithm: "hmac-sha256",
  payload: "{ts}.{rawBody}",
  encoding: "hex",
  toleranceMs: 300_000,
};

interface Answer {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

interface Call {
  readonly method: string;
  readonly url: URL;
  readonly headers: IncomingMessage["headers"];
  readonly rawBody: Buffer;
  readonly body: unknown;
}

interface Route {
  readonly operation: string;
  readonly method: string;
  readonly pattern: RegExp;
  readonly access: "user" | "service" | "public" | "stripe";
  readonly idempotent?: boolean;
  answer(call: Call, path: readonly string[]): Answer | Promise<Answer>;
}

const task = (taskId: string, title = "Write the slice test") => ({
  taskId,
  title,
  state: "open",
  version: 1,
  createdAt: "2026-10-18T09:00:00.000Z",
});

const ROUTES: readonly Route[] = [
  {
    operation: "health",
    method: "GET",
    pattern: /^\/v1\/health$/,
    access: "public",
    answer: () => ({ status: 200, body: { status: "ok" } }),
  },
  {
    operation: "listChannels",
    method: "GET",
    pattern: /^\/v1\/channels$/,
    access: "user",
    answer: (call) => page(call, [{ channelId: "channel-1", name: "General" }]),
  },
  {
    operation: "getChannel",
    method: "GET",
    pattern: /^\/v1\/channels\/([^/]+)$/,
    access: "user",
    answer: (_call, [channelId = ""]) => ({ status: 200, body: { channelId, name: "General" } }),
  },
  {
    operation: "listTasks",
    method: "GET",
    pattern: /^\/v1\/channels\/([^/]+)\/tasks$/,
    access: "user",
    answer: (call) => page(call, [task("task-1"), task("task-2")]),
  },
  {
    operation: "createTask",
    method: "POST",
    pattern: /^\/v1\/channels\/([^/]+)\/tasks$/,
    access: "user",
    idempotent: true,
    answer: (call) => createTask(call),
  },
  {
    operation: "getTasksBatch",
    method: "POST",
    pattern: /^\/v1\/channels\/([^/]+)\/tasks\/batch$/,
    access: "user",
    answer: (call) => ({ status: 200, body: idsOf(call.body).map((taskId) => task(taskId)) }),
  },
  {
    operation: "searchTasks",
    method: "POST",
    pattern: /^\/v1\/channels\/([^/]+)\/tasks\/search$/,
    access: "user",
    answer: (call) => searchTasks(call),
  },
  {
    operation: "getTask",
    method: "GET",
    pattern: /^\/v1\/channels\/([^/]+)\/tasks\/([^/]+)$/,
    access: "user",
    answer: (_call, [, taskId = ""]) => ({ status: 200, body: task(taskId) }),
  },
  {
    operation: "updateTask",
    method: "PATCH",
    pattern: /^\/v1\/channels\/([^/]+)\/tasks\/([^/]+)$/,
    access: "user",
    idempotent: true,
    answer: (_call, [, taskId = ""]) => ({ status: 200, body: { ...task(taskId), version: 2 } }),
  },
  {
    operation: "archiveTask",
    method: "POST",
    pattern: /^\/v1\/channels\/([^/]+)\/tasks\/([^/]+)\/archive$/,
    access: "user",
    idempotent: true,
    answer: (_call, [, taskId = ""]) => ({
      status: 200,
      body: { ...task(taskId), state: "archived", version: 2 },
    }),
  },
  {
    operation: "assignTask",
    method: "POST",
    pattern: /^\/v1\/channels\/([^/]+)\/tasks\/([^/]+)\/assign$/,
    access: "user",
    idempotent: true,
    answer: (_call, [, taskId = ""]) => ({ status: 200, body: task(taskId) }),
  },
  {
    operation: "purgeTask",
    method: "POST",
    pattern: /^\/v1\/channels\/([^/]+)\/tasks\/([^/]+)\/purge$/,
    access: "user",
    idempotent: true,
    answer: () => ({ status: 204 }),
  },
  {
    operation: "getDraft",
    method: "GET",
    pattern: /^\/v1\/me\/drafts\/([^/]+)$/,
    access: "user",
    answer: (_call, [draftId = ""]) => ({ status: 200, body: { draftId, body: "Draft text" } }),
  },
  {
    operation: "deleteDraft",
    method: "DELETE",
    pattern: /^\/v1\/me\/drafts\/([^/]+)$/,
    access: "user",
    idempotent: true,
    answer: (_call, [draftId = ""]) => ({ status: 200, body: { draftId, body: "Draft text" } }),
  },
  {
    operation: "getPreferences",
    method: "GET",
    pattern: /^\/v1\/me\/preferences$/,
    access: "user",
    answer: (call) =>
      call.headers["if-none-match"] === PREFERENCES_ETAG
        ? { status: 304, headers: { etag: PREFERENCES_ETAG } }
        : { status: 200, headers: { etag: PREFERENCES_ETAG }, body: { locale: "en" } },
  },
  {
    operation: "updatePreferences",
    method: "PATCH",
    pattern: /^\/v1\/me\/preferences$/,
    access: "user",
    idempotent: true,
    answer: (call) => ({ status: 200, body: { locale: "en", ...objectOf(call.body) } }),
  },
  {
    operation: "payments",
    method: "POST",
    pattern: /^\/v1\/hooks\/payments$/,
    access: "stripe",
    answer: () => ({ status: 204 }),
  },
  {
    operation: "tasksService.getTask",
    method: "GET",
    pattern: /^\/internal\/v1\/channels\/([^/]+)\/tasks\/([^/]+)$/,
    access: "service",
    answer: (call, [, taskId = ""]) => serviceGetTask(call, taskId),
  },
];

/** Starts the stub on a free local port. */
export async function startServer(): Promise<RunningServer> {
  const idempotencyStore = createMemoryIdempotencyStore();
  const server = createServer((request, response) => {
    handle(request, response, idempotencyStore).catch((error: unknown) => {
      send(response, problem(500, "api.internal", { detail: String(error) }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    baseUrl: `http://127.0.0.1:${portOf(server.address())}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  idempotencyStore: IdempotencyStore,
): Promise<void> {
  const call = await readCall(request);
  const matched = matchRoute(call);

  if (matched === undefined) {
    send(response, problem(404, "api.not_found"));

    return;
  }

  const { route, path } = matched;
  const denial = await accessDenial(route, call);

  if (denial !== undefined) {
    send(response, denial);

    return;
  }

  if (route.idempotent !== true) {
    send(response, await route.answer(call, path));

    return;
  }

  await answerIdempotently(route, call, path, idempotencyStore, response);
}

async function readCall(request: IncomingMessage): Promise<Call> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(Buffer.from(chunk));

  const rawBody = Buffer.concat(chunks);
  const text = rawBody.toString("utf8");

  return {
    method: request.method ?? "GET",
    url: new URL(request.url ?? "/", "http://stub.invalid"),
    headers: request.headers,
    rawBody,
    body: text === "" ? undefined : JSON.parse(text),
  };
}

function matchRoute(call: Call): { route: Route; path: string[] } | undefined {
  for (const route of ROUTES) {
    if (route.method !== call.method) continue;

    const match = route.pattern.exec(call.url.pathname);

    if (match !== null) return { route, path: match.slice(1).map(decodeURIComponent) };
  }

  return undefined;
}

async function accessDenial(route: Route, call: Call): Promise<Answer | undefined> {
  const authorization = call.headers.authorization;

  switch (route.access) {
    case "public":
      return undefined;
    case "user":
      return authorization === `Bearer ${USER_TOKEN}` ||
        authorization === `Bearer ${THROTTLED_USER_TOKEN}`
        ? undefined
        : problem(401, "api.unauthenticated");
    case "service":
      return authorization === `Bearer ${SERVICE_JWT}`
        ? undefined
        : problem(401, "api.unauthenticated");
    case "stripe":
      return verifyStripe(call);
  }
}

async function verifyStripe(call: Call): Promise<Answer | undefined> {
  const header = call.headers["stripe-signature"];

  if (typeof header !== "string") return problem(401, "api.unauthenticated");

  const pairs = header.split(",").map((pair) => pair.split("=", 2));
  const timestamp = pairs.find(([name]) => name === "t")?.[1];
  const candidateSignatures = pairs
    .filter(([name]) => name === "v1")
    .map(([, value = ""]) => value);

  if (timestamp === undefined || !/^[0-9]+$/.test(timestamp)) {
    return problem(401, "api.unauthenticated");
  }

  const verification = await verifyTemplateSignature(
    {
      verify: "template",
      rawBody: call.rawBody,
      timestamp,
      candidateSignatures,
      keyId: STRIPE_KEY_ID,
      template: STRIPE_TEMPLATE,
    },
    (keyId) => (keyId === STRIPE_KEY_ID ? [STRIPE_SECRET] : []),
  );

  return verification.verified ? undefined : problem(401, "api.unauthenticated");
}

async function answerIdempotently(
  route: Route,
  call: Call,
  path: readonly string[],
  store: IdempotencyStore,
  response: ServerResponse,
): Promise<void> {
  const clientKey = call.headers["idempotency-key"];

  if (typeof clientKey !== "string") {
    send(response, schemaInvalid("/headers/idempotency-key", "required"));

    return;
  }

  const key = digest([route.operation, String(call.headers.authorization), clientKey]);
  const begin = await store.begin({
    key,
    fingerprint: digest([call.method, call.url.pathname, call.rawBody.toString("utf8")]),
    lifetimeMs: IDEMPOTENCY_LIFETIME_MS,
    operation: { kind: "httpOperation", api: "tasks", id: route.operation },
  });

  switch (begin.outcome) {
    case "running":
      send(response, problem(409, "api.idempotency_in_progress"));

      return;
    case "mismatch":
      send(response, problem(422, "api.idempotency_key_reused"));

      return;
    case "replay":
      response.writeHead(begin.response.status, [
        ...begin.response.headers.flat(),
        "idempotency-replayed",
        "true",
      ]);
      response.end(begin.response.body);

      return;
    case "started":
      break;
  }

  const answer = await route.answer(call, path);
  const body =
    answer.body === undefined ? new Uint8Array() : Buffer.from(JSON.stringify(answer.body));
  const headers = Object.entries(headersOf(answer));

  await store.complete(key, { status: answer.status, headers, body });
  response.writeHead(answer.status, headers.flat());
  response.end(body);
}

function createTask(call: Call): Answer {
  if (call.headers.authorization === `Bearer ${THROTTLED_USER_TOKEN}`) {
    return problem(
      429,
      "api.rate_limited",
      { retryAfterMs: THROTTLE_RETRY_AFTER_MS },
      {
        "retry-after": String(Math.ceil(THROTTLE_RETRY_AFTER_MS / MILLISECONDS_PER_SECOND)),
      },
    );
  }

  const title = objectOf(call.body).title;

  if (typeof title !== "string" || title === "") return schemaInvalid("/body/title", "minLength");

  return { status: 201, body: task("task-new", title) };
}

async function searchTasks(call: Call): Promise<Answer> {
  if (objectOf(call.body).text === SLOW_SEARCH_TEXT) {
    await new Promise((resolve) => setTimeout(resolve, SLOW_SEARCH_DELAY_MS));
  }

  return { status: 200, body: { items: [task("task-1")], total: 1 } };
}

function serviceGetTask(call: Call, taskId: string): Answer {
  const deadline = call.headers["x-deadline"];

  if (typeof deadline !== "string" || Number.isNaN(Date.parse(deadline))) {
    return schemaInvalid("/headers/x-deadline", "format");
  }

  return { status: 200, body: task(taskId) };
}

// The first page links the next one through its cursor; a page asked with a cursor is the last.
function page(call: Call, items: readonly unknown[]): Answer {
  if (call.url.searchParams.has("cursor")) return { status: 200, body: items };

  const next = new URL(call.url.pathname, "http://stub.invalid");

  next.searchParams.set("cursor", NEXT_CURSOR);

  return {
    status: 200,
    headers: { link: `<${next.pathname}${next.search}>; rel="next"` },
    body: items,
  };
}

function problem(
  status: number,
  code: string,
  params: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
): Answer {
  return {
    status,
    headers: { "content-type": PROBLEM_MEDIA, ...headers },
    body: { type: code, title: code, status, code, ...params },
  };
}

function schemaInvalid(pointer: string, rule: string): Answer {
  return problem(400, "api.schema_invalid", { issues: [{ pointer, rule }] });
}

function send(response: ServerResponse, answer: Answer): void {
  const headers = headersOf(answer);

  response.writeHead(answer.status, headers);
  response.end(answer.body === undefined ? undefined : JSON.stringify(answer.body));
}

function headersOf(answer: Answer): Record<string, string> {
  return answer.body === undefined
    ? { ...answer.headers }
    : { "content-type": JSON_MEDIA, ...answer.headers };
}

function portOf(address: AddressInfo | string | null): number {
  if (address === null || typeof address === "string") {
    throw new Error(`The stub server listens on ${String(address)}, not on a TCP port.`);
  }

  return address.port;
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function idsOf(body: unknown): string[] {
  const ids = objectOf(body).ids;

  return Array.isArray(ids) ? ids.map(String) : [];
}
