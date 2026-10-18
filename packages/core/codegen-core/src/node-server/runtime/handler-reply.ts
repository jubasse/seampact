// Step 10 of the check order (ADR 0012) for the handler's result: a declared error becomes a contract error; a
// declared success is projected (restricted output fields absent, undeclared members stripped), paged, given its
// derived ETag or 304 and its cache headers. Copied into the generated tree as is.
import { createHash } from "node:crypto";
import { type AccessGrant, type CheckState, decide } from "./access-checks.js";
import {
  ContractError,
  type ContractReply,
  isPlainObject,
  unexpectedError,
} from "./contract-error.js";
import {
  type ContractRoute,
  headerValue,
  type ResponseEntry,
  type ValueShape,
} from "./contract-route.js";

const JSON_MEDIA = "application/json";
const NOT_MODIFIED = 304;
const WEAK_PREFIX = "W/";

/** The reply of a handler's result, or the contract error it names. */
export async function handlerReply(
  state: CheckState,
  grant: AccessGrant,
  result: unknown,
): Promise<ContractReply> {
  const { route } = state;

  if (!isPlainObject(result) || typeof result.status !== "number") {
    throw unexpectedError(route, new Error(`the handler of '${route.id}' returned no { status }`));
  }

  if (typeof result.code === "string") throw declaredHandlerError(route, result);

  const response = route.responses.find((candidate) => candidate.status === result.status);

  if (response === undefined || response.status === NOT_MODIFIED) {
    throw unexpectedError(
      route,
      new Error(`the handler of '${route.id}' answered the undeclared status ${result.status}`),
    );
  }

  return successReply(state, grant, response, result.body);
}

function declaredHandlerError(
  route: ContractRoute,
  result: Record<string, unknown>,
): ContractError {
  const code = String(result.code);
  const entry = Object.hasOwn(route.errors, code) ? route.errors[code] : undefined;

  if (entry === undefined || entry.status !== result.status) {
    return unexpectedError(
      route,
      new Error(
        `the handler of '${route.id}' answered ${result.status} ${code}, which the operation does not declare`,
      ),
    );
  }

  return new ContractError(code, result.params);
}

async function successReply(
  state: CheckState,
  grant: AccessGrant,
  response: ResponseEntry,
  handlerBody: unknown,
): Promise<ContractReply> {
  const { route } = state;
  const headers: [string, string][] = [];

  if (response.shape === "empty" || response.body === undefined) {
    return { status: response.status, headers, body: new Uint8Array() };
  }

  const payload = response.shape === "page" ? pageItems(state, handlerBody, headers) : handlerBody;
  const projected = await project(state, grant, response.body, payload);
  const body = new TextEncoder().encode(JSON.stringify(projected));

  headers.unshift(["content-type", JSON_MEDIA]);
  appendCacheHeaders(route, grant, headers);

  if (route.cache?.etag === true) {
    const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;

    headers.push(["etag", etag]);

    if (ifNoneMatchHolds(headerValue(state.request.headers, "if-none-match"), etag)) {
      return {
        status: NOT_MODIFIED,
        headers: headers.filter(([name]) => name !== "content-type"),
        body: new Uint8Array(),
      };
    }
  }

  return { status: response.status, headers, body };
}

// A page result `{ items, nextCursor? }`: the body is its items, the next page is linked by its cursor.
function pageItems(state: CheckState, handlerBody: unknown, headers: [string, string][]): unknown {
  const paging = state.route.paging;

  if (!isPlainObject(handlerBody) || !Array.isArray(handlerBody.items) || paging === undefined) {
    throw unexpectedError(
      state.route,
      new Error(`the handler of '${state.route.id}' returned no page { items }`),
    );
  }

  const nextCursor = handlerBody[paging.nextCursorMember];

  if (typeof nextCursor === "string") {
    const query = new URLSearchParams(state.request.rawQuery);

    query.set(paging.cursorParam, nextCursor);
    headers.push(["link", `<${state.request.path}?${query.toString()}>; rel="next"`]);
  }

  return handlerBody.items;
}

function appendCacheHeaders(
  route: ContractRoute,
  grant: AccessGrant,
  headers: [string, string][],
): void {
  const cache = route.cache;

  if (cache === undefined) return;

  const callerKind =
    grant.principal === null || grant.principal === undefined ? "anonymous" : "identified";
  const cacheControl = cache.cacheControl[callerKind];

  if (cacheControl !== undefined) headers.push(["cache-control", cacheControl]);

  if (cache.vary.length > 0) headers.push(["vary", cache.vary.join(", ")]);
}

function ifNoneMatchHolds(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;

  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || tag === etag || tag === `${WEAK_PREFIX}${etag}`);
}

// Keeps the declared members of each object, and drops a restricted output field the caller has no right to.
async function project(
  state: CheckState,
  grant: AccessGrant,
  shape: ValueShape,
  value: unknown,
  schema?: string,
): Promise<unknown> {
  switch (shape.kind) {
    case "leaf":
      return value;
    case "ref": {
      const target = state.api.shapes[shape.schema];

      if (target === undefined) {
        throw unexpectedError(
          state.route,
          new Error(`no output shape for the schema '${shape.schema}'`),
        );
      }

      return project(state, grant, target, value, shape.schema);
    }
    case "array":
      return Array.isArray(value)
        ? Promise.all(value.map((item) => project(state, grant, shape.items, item)))
        : value;
    case "object":
      return isPlainObject(value) ? projectObject(state, grant, shape, value, schema) : value;
  }
}

async function projectObject(
  state: CheckState,
  grant: AccessGrant,
  shape: Extract<ValueShape, { kind: "object" }>,
  value: Readonly<Record<string, unknown>>,
  schema: string | undefined,
): Promise<Record<string, unknown>> {
  const projected: Record<string, unknown> = {};

  for (const [member, memberShape] of Object.entries(shape.properties)) {
    if (Object.hasOwn(value, member)) {
      projected[member] = await project(state, grant, memberShape, value[member]);
    }
  }

  const outputRights = state.route.fieldRights.filter(
    (fieldRight) => fieldRight.direction === "output" && fieldRight.schema === schema,
  );

  for (const fieldRight of outputRights) {
    const segments = fieldRight.pointer.split("/").slice(1).map(unescapePointer);

    await dropDeniedField(projected, segments, async (holder) => {
      const denial = await decide(state, grant, {
        kind: "right",
        name: fieldRight.right,
        params: fieldRight.params,
        subject: fieldRight.subject,
        errors: fieldRight.errors,
        purpose: { kind: "field", pointer: fieldRight.pointer, direction: "output" },
        holder,
      });

      // A denied output field is absent; a hook failure still answers 500.
      if (denial !== undefined && denial.unexpectedCause !== undefined) throw denial;

      return denial !== undefined;
    });
  }

  return projected;
}

// Walks a field pointer (`/items/*/effort`, `*` for each array item) and removes the member from each holder
// the decider denies.
async function dropDeniedField(
  value: unknown,
  segments: readonly string[],
  isDenied: (holder: Readonly<Record<string, unknown>>) => Promise<boolean>,
): Promise<void> {
  const [segment, ...rest] = segments;

  if (segment === undefined) return;

  if (segment === "*") {
    if (Array.isArray(value)) {
      for (const item of value) await dropDeniedField(item, rest, isDenied);
    }

    return;
  }

  if (!isPlainObject(value) || !Object.hasOwn(value, segment)) return;

  if (rest.length > 0) {
    await dropDeniedField(value[segment], rest, isDenied);

    return;
  }

  if (await isDenied(value)) delete value[segment];
}

function unescapePointer(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}
