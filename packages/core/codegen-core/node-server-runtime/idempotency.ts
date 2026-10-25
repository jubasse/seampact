// Idempotency at the boundary: the claim's fixed-size key and fingerprint, begin with its replay, running and
// mismatch answers, and the record completed or abandoned with the reply that went out. Copied into the generated
// tree as is.
import type { StoredResponse } from "@seampact/hooks";
import type { AccessGrant, CheckState } from "./access-checks.js";
import type { BoundaryHooks } from "./boundary-hooks.js";
import {
  ContractError,
  type ContractReply,
  codeOfRole,
  isPlainObject,
  unexpectedError,
} from "./contract-error.js";
import type { ContractRoute } from "./contract-route.js";
import { runtimeLog } from "./runtime-logger.js";
import { sha256Hex } from "./sha256.js";

const IN_PROGRESS_ROLE = "idempotencyInProgress";
const KEY_REUSED_ROLE = "idempotencyKeyReused";
const SERVER_ERROR_FLOOR = 500;
const CLIENT_ERROR_FLOOR = 400;
const REPLAYED = "true";

export type IdempotencyStart =
  | { readonly outcome: "replay"; readonly reply: ContractReply }
  | { readonly outcome: "started"; readonly key: string };

/** Claims the request's key; undefined when the operation is not idempotent or the client sent no key. */
export async function beginIdempotency(
  state: CheckState,
  grant: AccessGrant,
  input: unknown,
): Promise<IdempotencyStart | undefined> {
  const { route } = state;
  const idempotency = route.idempotency;

  if (idempotency === undefined) return undefined;

  const headers = isPlainObject(input) && isPlainObject(input.headers) ? input.headers : {};
  const clientKey = headers[idempotency.header.toLowerCase()];

  if (typeof clientKey !== "string") return undefined;

  const store = state.hooks.idempotencyStore;

  if (store === undefined) {
    throw unexpectedError(route, new Error(`no idempotency store is registered for '${route.id}'`));
  }

  const principalDigest =
    grant.principal === null || grant.principal === undefined
      ? ""
      : await digest([grant.principal]);
  const key = await digest([
    state.api.id,
    route.id,
    grant.identity ?? "",
    principalDigest,
    clientKey,
  ]);
  const fingerprint = await idempotencyFingerprint(route, input);
  const begin = await store.begin({
    key,
    fingerprint,
    lifetimeMs: idempotency.lifetimeMs,
    operation: { kind: "httpOperation", api: state.api.id, id: route.id },
  });

  switch (begin.outcome) {
    case "started":
      return { outcome: "started", key };
    case "running":
      throw new ContractError(roleCode(state, IN_PROGRESS_ROLE));
    case "mismatch":
      throw new ContractError(roleCode(state, KEY_REUSED_ROLE));
    case "replay":
      return { outcome: "replay", reply: replayOf(begin.response, idempotency.replayHeader) };
  }
}

/** The digest a retry under the same key must match: the method, the contract path and the validated input. */
export function idempotencyFingerprint(
  route: Pick<ContractRoute, "method" | "path" | "access">,
  input: unknown,
): Promise<string> {
  // The validated input holds the decoded path params, so an equivalent encoding of the path is the same request.
  return digest([route.method, route.path, input]);
}

function replayOf(stored: StoredResponse, replayHeader: string): ContractReply {
  const headers = stored.headers.filter(([name]) => name !== replayHeader.toLowerCase());

  return {
    status: stored.status,
    headers:
      stored.status < CLIENT_ERROR_FLOOR
        ? [...headers, [replayHeader.toLowerCase(), REPLAYED]]
        : headers,
    body: stored.body,
  };
}

/** Completes the record with the reply that went out, or abandons it after a server error. */
export async function settleIdempotency(
  hooks: BoundaryHooks | undefined,
  key: string,
  reply: ContractReply,
): Promise<void> {
  const store = hooks?.idempotencyStore;

  if (store === undefined) return;

  try {
    if (reply.status >= SERVER_ERROR_FLOOR) await store.abandon(key);
    else
      await store.complete(key, { status: reply.status, headers: reply.headers, body: reply.body });
  } catch (error) {
    runtimeLog.error(
      "seampact: the idempotency store failed to record a reply; a retry with the same key may run again. Check the store's backend.",
      error,
    );
  }
}

function roleCode(state: CheckState, role: string): string {
  const code = codeOfRole(state.route, role);

  if (code === undefined) {
    throw unexpectedError(
      state.route,
      new Error(`operation '${state.route.id}' declares no ${role} code`),
    );
  }

  return code;
}

// Object members sorted by name, so the same request with its members reordered digests the same.
function digest(parts: readonly unknown[]): Promise<string> {
  return sha256Hex(JSON.stringify(parts, sortedMembers));
}

function sortedMembers(_name: string, value: unknown): unknown {
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((name) => [name, value[name]]),
  );
}
