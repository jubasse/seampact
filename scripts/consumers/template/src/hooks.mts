// The hooks every Node server consumer registers, framework-neutral: each overlay passes them to its target's
// registration, which checks them against the generated hook types. They honour `test/credentials.mts`.
import type {
  AuthenticateRequest,
  AuthenticateResult,
  Decision,
  IdempotencyStore,
  RequirementRequest,
  ResolvedScope,
  ResolveScopeRequest,
} from "@seampact/hooks";
import { createMemoryIdempotencyStore } from "@seampact/idempotency-memory";
import { verifyTemplateSignature } from "@seampact/signed-webhooks";
import {
  SERVICE_JWT,
  SERVICE_NAME,
  STRIPE_KEY_ID,
  STRIPE_SECRET,
  THROTTLE_RETRY_AFTER_MS,
  THROTTLED_USER_ID,
  THROTTLED_USER_TOKEN,
  USER_ID,
  USER_TOKEN,
} from "../test/credentials.mjs";

const UNAUTHENTICATED = { deny: { code: "api.unauthenticated" } } as const;
const STRIPE_ACCOUNT = "acct_seampact";
const THROTTLE_RULE = "throttle";

type Unauthenticated = { readonly code: "api.unauthenticated" };
type RateLimited = { readonly code: "api.rate_limited"; readonly params: { retryAfterMs: number } };

const USER_IDS_BY_TOKEN: ReadonlyMap<string, string> = new Map([
  [USER_TOKEN, USER_ID],
  [THROTTLED_USER_TOKEN, THROTTLED_USER_ID],
]);

/** The `user` identity: a bearer token of the credentials table. */
export const userAuthenticateHook = {
  authenticate(
    request: AuthenticateRequest<{ readonly bearer?: string }>,
  ): AuthenticateResult<{ userId: string }, Unauthenticated> {
    const userId = USER_IDS_BY_TOKEN.get(request.credentials.bearer ?? "");

    return userId === undefined ? UNAUTHENTICATED : { principal: { userId } };
  },
};

/** The `service` identity: the fixed service JWT, accepted as is. */
export const serviceAuthenticateHook = {
  authenticate(
    request: AuthenticateRequest<{ readonly internalToken?: string }>,
  ): AuthenticateResult<{ service: typeof SERVICE_NAME; userId: string }, Unauthenticated> {
    return request.credentials.internalToken === SERVICE_JWT
      ? { principal: { service: SERVICE_NAME, userId: USER_ID } }
      : UNAUTHENTICATED;
  },
};

/** The `stripe` identity: the signed request verified with `@seampact/signed-webhooks`. */
export const stripeAuthenticateHook = {
  async authenticate(
    request: AuthenticateRequest<object>,
  ): Promise<AuthenticateResult<{ account: string }, Unauthenticated>> {
    const signature = request.signature;

    if (signature?.verify !== "template") return UNAUTHENTICATED;

    const verification = await verifyTemplateSignature(signature, (keyId) =>
      keyId === STRIPE_KEY_ID ? [STRIPE_SECRET] : [],
    );

    return verification.verified ? { principal: { account: STRIPE_ACCOUNT } } : UNAUTHENTICATED;
  },
};

/** Allows every right and rule. */
export const allowingDeciderHook = {
  decide(_request: RequirementRequest): { readonly allow: true } {
    return { allow: true };
  },
};

/** Allows every right and rule, except the throttle rule for the throttled user. */
export const throttlingDeciderHook = {
  decide(request: RequirementRequest): Decision<RateLimited> {
    if (request.name === THROTTLE_RULE && userIdOf(request.principal) === THROTTLED_USER_ID) {
      return {
        deny: { code: "api.rate_limited", params: { retryAfterMs: THROTTLE_RETRY_AFTER_MS } },
      };
    }

    return { allow: true };
  },
};

/** Resolves a declared scope id to itself: every channel exists. */
export const scopeResolverHook = {
  resolveScope(request: ResolveScopeRequest): { readonly resolved: ResolvedScope } {
    if (request.source.resolver !== "declared") {
      throw new Error(`the consumer resolves declared scope ids only, not '${request.scope}'`);
    }

    return { resolved: { scope: request.scope, id: request.source.id } };
  },
};

export function createIdempotencyStore(): IdempotencyStore {
  return createMemoryIdempotencyStore();
}

function userIdOf(principal: unknown): string | undefined {
  if (typeof principal !== "object" || principal === null || !("userId" in principal)) {
    return undefined;
  }

  return typeof principal.userId === "string" ? principal.userId : undefined;
}

/** The `tasks` api's hooks, as every overlay registers them; the registration checks them against its hook types. */
export function tasksHooks() {
  return {
    authenticate: { user: userAuthenticateHook, stripe: stripeAuthenticateHook },
    deciders: [{ names: "all" as const, decider: throttlingDeciderHook }],
    scopeResolvers: { channel: scopeResolverHook },
    idempotencyStore: createIdempotencyStore(),
  };
}

/** The `tasksService` api's hooks, as every overlay registers them. */
export function tasksServiceHooks() {
  return {
    authenticate: { service: serviceAuthenticateHook },
    deciders: [{ names: "all" as const, decider: allowingDeciderHook }],
    scopeResolvers: {},
  };
}
