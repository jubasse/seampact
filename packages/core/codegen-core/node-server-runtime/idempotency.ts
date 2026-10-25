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
import { idempotencyDigest, idempotencyFingerprint } from "./idempotency-fingerprint.js";
import { CACHE_CONTROL_HEADER, groupedHeaders, hasNoStoreDirective } from "./reply-headers.js";
import { runtimeLog } from "./runtime-logger.js";

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
      : await idempotencyDigest([grant.principal]);
  const key = await idempotencyDigest([
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

/** Completes the record with the reply that went out, or abandons it after a server error or a `no-store` reply. */
export async function settleIdempotency(
  hooks: BoundaryHooks | undefined,
  key: string,
  reply: ContractReply,
): Promise<void> {
  const store = hooks?.idempotencyStore;

  if (store === undefined) return;

  try {
    if (!isKeptForReplay(reply)) await store.abandon(key);
    else
      await store.complete(key, { status: reply.status, headers: reply.headers, body: reply.body });
  } catch (error) {
    runtimeLog.error(
      "seampact: the idempotency store failed to record a reply; a retry with the same key may run again. Check the store's backend.",
      error,
    );
  }
}

// A reply its sender marked `no-store` must not be kept, so it is dropped for a replay as a server error is.
function isKeptForReplay(reply: ContractReply): boolean {
  if (reply.status >= SERVER_ERROR_FLOOR) return false;

  const cacheControl = groupedHeaders(reply.headers).get(CACHE_CONTROL_HEADER) ?? [];

  return !hasNoStoreDirective(cacheControl.join(","));
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
