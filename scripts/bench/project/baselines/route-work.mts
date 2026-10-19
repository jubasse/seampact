// The work every hand-written baseline route does once its framework has routed the request and parsed the body:
// authenticate, validate, resolve the scope, decide the requirements, claim the idempotency key, call the
// handler, then check the reply against its response schema and cut it to the declared shape (what the generated
// route does with `bodyValidation` on). The hooks and handlers are the consumer template's own, so only the boundary differs from the
// generated route.
import { createHash } from "node:crypto";
import { verifyTemplateSignature } from "@seampact/signed-webhooks";
import { tasksHandlers } from "../../src/handlers.mjs";
import { tasksHooks } from "../../src/hooks.mjs";
import {
  STRIPE_KEY_ID,
  STRIPE_SECRET,
  THROTTLED_USER_ID,
  THROTTLED_USER_TOKEN,
  USER_ID,
  USER_TOKEN,
} from "../../test/credentials.mjs";
import type { RouteOutput } from "./validators/response-facts.mjs";

/** What a framework hands over once it has routed the request and parsed the body. */
export interface BaselineRequest {
  readonly path: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: unknown;
  readonly rawBody?: Buffer;
  /** The request target as received: the path and the query. */
  readonly url: string;
}

export interface BaselineReply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

type Principal = Readonly<Record<string, string>> | null;

interface Requirement {
  readonly kind: "right" | "rule";
  readonly name: string;
  readonly params?: unknown;
  readonly bucketId?: string;
  /** The path param that names the subject the decider is asked about. */
  readonly subject?: { readonly type: string; readonly idParam: string };
}

type RouteMethod = "get" | "post" | "patch";

export interface BaselineRoute {
  readonly method: RouteMethod;
  readonly path: string;
  readonly identity: "user" | "stripe" | undefined;
  readonly scoped?: boolean;
  readonly requirements?: readonly Requirement[];
  readonly idempotent?: boolean;
  /** The success body is a page: the items alone, the next cursor in a `link` header. */
  readonly paged?: boolean;
  /** The success reply carries a body the response schema checks. */
  readonly answersBody?: boolean;
  readonly requiredHeaders?: readonly string[];
}

const hooks = tasksHooks();
const decider = hooks.deciders[0].decider;
const scopeResolver = hooks.scopeResolvers.channel;
const idempotencyStore = hooks.idempotencyStore;

const validatorsId = process.env.BENCH_VALIDATORS;

if (validatorsId === undefined) {
  throw new Error(
    "bench: BENCH_VALIDATORS names the validator library of the baseline; it is unset.",
  );
}

const {
  validateRouteInput,
  validateRouteOutput,
}: { validateRouteInput: ValidateRouteInput; validateRouteOutput: ValidateRouteOutput } =
  await import(`./validators/${validatorsId}.mjs`);

type ValidateRouteInput = (routeId: string, parts: unknown) => Promise<readonly string[]>;
type ValidateRouteOutput = (routeId: string, body: unknown) => Promise<RouteOutput>;

const API_ID = "tasks";
const IDEMPOTENCY_HEADER = "idempotency-key";
const IDEMPOTENCY_LIFETIME_MS = 86_400_000;
const SIGNATURE_HEADER = "stripe-signature";
const SIGNATURE_TOLERANCE_MS = 300_000;
const SIGNATURE_PAIRS = /^t=([0-9]+),v1=([0-9a-fA-F]+)$/;
const BEARER_PREFIX = "Bearer ";
const JSON_HEADERS = [["content-type", "application/json; charset=utf-8"]];

const USER_IDS_BY_TOKEN = new Map([
  [USER_TOKEN, USER_ID],
  [THROTTLED_USER_TOKEN, THROTTLED_USER_ID],
]);

const RATE_LIMITED = "api.rate_limited";
const RATE_LIMITED_STATUS = 429;
const DENIED_STATUS = 403;
const MILLISECONDS_PER_SECOND = 1000;

const THROTTLE = { kind: "rule", name: "throttle", bucketId: "write" };
const CHANNEL_EDITOR = {
  kind: "right",
  name: "roles",
  params: { allowed: ["owner", "editor"] },
  subject: { type: "channel", idParam: "channelId" },
};

/** The contract facts of the five measured routes, and the health floor, as the check order reads them. */
export const BASELINE_ROUTES: Readonly<Record<string, BaselineRoute>> = {
  health: { method: "get", path: "/v1/health", identity: undefined, answersBody: true },
  getChannel: {
    method: "get",
    path: "/v1/channels/{channelId}",
    identity: "user",
    scoped: true,
    answersBody: true,
  },
  listTasks: {
    method: "get",
    path: "/v1/channels/{channelId}/tasks",
    identity: "user",
    scoped: true,
    paged: true,
    answersBody: true,
  },
  createTask: {
    method: "post",
    path: "/v1/channels/{channelId}/tasks",
    identity: "user",
    scoped: true,
    requirements: [THROTTLE, CHANNEL_EDITOR],
    idempotent: true,
    answersBody: true,
    requiredHeaders: [IDEMPOTENCY_HEADER],
  },
  updateTask: {
    method: "patch",
    path: "/v1/channels/{channelId}/tasks/{taskId}",
    identity: "user",
    scoped: true,
    requirements: [
      { kind: "right", name: "tasks.update", subject: { type: "task", idParam: "taskId" } },
    ],
    idempotent: true,
    answersBody: true,
    requiredHeaders: [IDEMPOTENCY_HEADER],
  },
  payments: {
    method: "post",
    path: "/v1/hooks/payments",
    identity: "stripe",
    requiredHeaders: [SIGNATURE_HEADER],
  },
};

/** `/v1/channels/{channelId}` as a framework router spells it: `/v1/channels/:channelId`. */
export function colonPath(contractPath: string): string {
  return contractPath.replace(/\{([A-Za-z]+)\}/g, ":$1");
}

/**
 * Runs one baseline route. `request` carries `path` and `query` records, lower-case `headers`, the parsed `body`
 * and, on the signed route, the `rawBody` bytes; the answer is `{ status, body }`.
 */
export async function runBaselineRoute(
  routeId: string,
  request: BaselineRequest,
): Promise<BaselineReply> {
  const route = BASELINE_ROUTES[routeId];

  if (route === undefined) throw new Error(`bench: no baseline route '${routeId}'.`);

  const principal = await authenticate(route, request);

  if (principal === undefined) return refusal(401, "api.unauthenticated");

  const missing = (route.requiredHeaders ?? []).filter(
    (name) => typeof request.headers[name] !== "string",
  );
  const issues = [
    ...missing.map((name) => `header ${name} is required`),
    ...(await validateRouteInput(routeId, decoded(routeId, request))),
  ];

  if (issues.length > 0) return refusal(400, "api.schema_invalid", { issues });

  const scopes = route.scoped ? [await resolveScope(request.path.channelId)] : [];
  const denial = await firstDenial(route, routeId, principal, scopes, request);

  if (denial !== undefined) return denied(denial);

  const input = {
    path: request.path,
    query: decoded(routeId, request).query,
    headers: request.headers,
    body: request.body,
  };

  if (!route.idempotent)
    return answer(route, routeId, request, await tasksHandlers[routeId](input));

  return idempotently(routeId, principal, request, () => tasksHandlers[routeId](input));
}

async function authenticate(
  route: BaselineRoute,
  request: BaselineRequest,
): Promise<Principal | undefined> {
  if (route.identity === undefined) return null;

  if (route.identity === "stripe")
    return (await verifiedSignature(request)) ? { account: "acct_seampact" } : undefined;

  const header = request.headers.authorization;

  if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) return undefined;

  const userId = USER_IDS_BY_TOKEN.get(header.slice(BEARER_PREFIX.length));

  return userId === undefined ? undefined : { userId };
}

async function verifiedSignature(request: BaselineRequest): Promise<boolean> {
  const match = SIGNATURE_PAIRS.exec(request.headers[SIGNATURE_HEADER] ?? "");

  if (match === null || request.rawBody === undefined) return false;

  const verification = await verifyTemplateSignature(
    {
      verify: "template",
      rawBody: request.rawBody,
      timestamp: match[1],
      candidateSignatures: [match[2]],
      keyId: STRIPE_KEY_ID,
      template: {
        algorithm: "hmac-sha256",
        payload: "{ts}.{rawBody}",
        encoding: "hex",
        toleranceMs: SIGNATURE_TOLERANCE_MS,
      },
    },
    (keyId) => (keyId === STRIPE_KEY_ID ? [STRIPE_SECRET] : []),
  );

  return verification.verified;
}

// The decoded query of the route: a number and a list where the contract declares them, text elsewhere.
function decoded(routeId: string, request: BaselineRequest): BaselineRequest {
  if (routeId !== "listTasks") return request;

  const { limit, sort, ...rest } = request.query;

  return {
    ...request,
    query: {
      ...rest,
      ...(limit === undefined ? {} : { limit: /^[0-9]+$/.test(limit) ? Number(limit) : limit }),
      ...(sort === undefined ? {} : { sort: sort === "" ? [] : sort.split(",") }),
    },
  };
}

async function resolveScope(channelId: string | undefined) {
  const { resolved } = await scopeResolver.resolveScope({
    scope: "channel",
    source: { resolver: "declared", id: channelId },
  });

  return resolved;
}

async function firstDenial(
  route: BaselineRoute,
  routeId: string,
  principal: Principal,
  scopes: readonly unknown[],
  request: BaselineRequest,
) {
  for (const requirement of route.requirements ?? []) {
    const decision = await decider.decide(
      decideRequest(route, routeId, requirement, principal, scopes, request),
    );

    if (decision.deny !== undefined) return decision.deny;
  }

  return undefined;
}

// The request the generated boundary hands a decider: purpose, operation, request view and extensions included.
function decideRequest(
  route: BaselineRoute,
  routeId: string,
  requirement: Requirement,
  principal: Principal,
  scopes: readonly unknown[],
  request: BaselineRequest,
) {
  const { bucketId, subject, ...declared } = requirement;

  return {
    ...declared,
    principal,
    scopes,
    ...(subject === undefined
      ? {}
      : { subject: { type: subject.type, id: request.path[subject.idParam] } }),
    ...(bucketId === undefined
      ? {}
      : { bucket: { id: bucketId, key: digest([principal]), values: [principal] } }),
    purpose: { kind: "route" },
    operation: { kind: "httpOperation", api: API_ID, id: routeId },
    request: { method: route.method.toUpperCase(), path: route.path, headers: {} },
    extensions: { requirement: {}, operation: {} },
  };
}

async function idempotently(
  routeId: string,
  principal: Principal,
  request: BaselineRequest,
  run: () => unknown,
): Promise<BaselineReply> {
  const route = BASELINE_ROUTES[routeId];
  const clientKey = request.headers[IDEMPOTENCY_HEADER];
  const key = digest([API_ID, routeId, "user", digest([principal]), clientKey]);
  const begin = await idempotencyStore.begin({
    key,
    fingerprint: digest([route.method, route.path, request.path, request.query, request.body]),
    lifetimeMs: IDEMPOTENCY_LIFETIME_MS,
    operation: { kind: "httpOperation", api: API_ID, id: routeId },
  });

  if (begin.outcome === "replay") {
    return {
      status: begin.response.status,
      body: JSON.parse(Buffer.from(begin.response.body).toString()),
    };
  }

  if (begin.outcome === "mismatch") return refusal(422, "api.idempotency_key_reused");

  if (begin.outcome !== "started") return refusal(409, "api.idempotency_in_progress");

  const reply = await answer(route, routeId, request, await run());

  await idempotencyStore.complete(key, {
    status: reply.status,
    headers: JSON_HEADERS,
    body: Buffer.from(JSON.stringify(reply.body)),
  });

  return reply;
}

function digest(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

async function answer(
  route: BaselineRoute,
  routeId: string,
  request: BaselineRequest,
  output: { status: number; body?: unknown },
): Promise<BaselineReply> {
  const reply = pagedReply(route, request, output);

  if (!route.answersBody) return reply;

  const checked = await validateRouteOutput(routeId, reply.body);

  if (checked.issues.length > 0)
    return refusal(500, "api.response_invalid", { issues: checked.issues });

  return { ...reply, body: checked.body };
}

function pagedReply(
  route: BaselineRoute,
  request: BaselineRequest,
  output: { status: number; body?: unknown },
): BaselineReply {
  if (!route.paged) return { status: output.status, body: output.body };

  const { items, nextCursor } = output.body as { items: unknown; nextCursor?: string };

  if (nextCursor === undefined) return { status: output.status, body: items };

  const separator = request.url.includes("?") ? "&" : "?";

  return {
    status: output.status,
    body: items,
    headers: { link: `<${request.url}${separator}cursor=${nextCursor}>; rel="next"` },
  };
}

// A denial of the decider as the generated route answers it: 403, or 429 with the delay in the body and, in whole
// seconds rounded up, in `retry-after`.
function denied(denial: { code: string; params?: { retryAfterMs?: number } }): BaselineReply {
  if (denial.code !== RATE_LIMITED) return refusal(DENIED_STATUS, denial.code, denial.params);

  const retryAfterMs = denial.params?.retryAfterMs;

  return {
    ...refusal(RATE_LIMITED_STATUS, RATE_LIMITED, denial.params),
    ...(retryAfterMs === undefined
      ? {}
      : { headers: { "retry-after": String(Math.ceil(retryAfterMs / MILLISECONDS_PER_SECOND)) } }),
  };
}

function refusal(status: number, code: string, params: object = {}): BaselineReply {
  return { status, body: { code, ...params } };
}
