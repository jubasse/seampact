// The hooks every Node server consumer registers, framework-neutral: each overlay passes them to its target's
// registration, which checks them against the generated hook types. They honour `test/credentials.mts`, answer
// from the script a case loads through the control routes, and record each authenticate and decide call there.
import type {
  AuthenticateRequest,
  AuthenticateResult,
  Decision,
  IdempotencyStore,
  RequirementRequest,
  ResolvedScope,
  ResolveScopeRequest,
  ScopeResolution,
} from "@seampact/hooks";
import { authenticateHookName, decideHookName, type ScriptedDenial } from "@seampact/http-suite";
import { createMemoryIdempotencyStore } from "@seampact/idempotency-memory";
import { verifyTemplateSignature } from "@seampact/signed-webhooks";
import {
  FOREIGN_SERVICE_JWT,
  FOREIGN_SERVICE_NAME,
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
import {
  recordHookCall,
  scriptedDecision,
  scriptedScopeDenial,
  writeLogLine,
} from "./suite-control.mjs";

const UNAUTHENTICATED = { deny: { code: "api.unauthenticated" } } as const;
const STRIPE_ACCOUNT = "acct_seampact";
const THROTTLE_RULE = "throttle";
const CALLER_SERVICE_RIGHT = "callerService";
const ROLES_RIGHT = "roles";
const FORBIDDEN: Forbidden = { code: "api.forbidden", params: {} };

type Unauthenticated = { readonly code: "api.unauthenticated" };
type RateLimited = { readonly code: "api.rate_limited"; readonly params: { retryAfterMs: number } };
type Forbidden = { readonly code: "api.forbidden"; readonly params: { pointer?: string } };
type NotFound = { readonly code: "api.not_found" };
type ReauthenticationRequired = { readonly code: "api.reauthentication_required" };

/** Every code a decide hook of the `tasks` api may deny with. */
type TasksDenial = RateLimited | Forbidden | NotFound | ReauthenticationRequired;

type ServiceName = typeof SERVICE_NAME | typeof FOREIGN_SERVICE_NAME;

const USER_IDS_BY_TOKEN: ReadonlyMap<string, string> = new Map([
  [USER_TOKEN, USER_ID],
  [THROTTLED_USER_TOKEN, THROTTLED_USER_ID],
]);

const SERVICES_BY_TOKEN: ReadonlyMap<string, ServiceName> = new Map<string, ServiceName>([
  [SERVICE_JWT, SERVICE_NAME],
  [FOREIGN_SERVICE_JWT, FOREIGN_SERVICE_NAME],
]);

/** The `user` identity: a bearer token of the credentials table, or the same token as the session cookie. */
export const userAuthenticateHook = {
  authenticate(
    request: AuthenticateRequest<{ readonly bearer?: string; readonly sessionCookie?: string }>,
  ): AuthenticateResult<{ userId: string }, Unauthenticated> {
    recordHookCall(authenticateHookName("user"), request.operation);

    const token = request.credentials.bearer ?? request.credentials.sessionCookie ?? "";
    const userId = USER_IDS_BY_TOKEN.get(token);

    return userId === undefined ? UNAUTHENTICATED : { principal: { userId } };
  },
};

/** The `service` identity: one of the fixed service JWTs, accepted as is. */
export const serviceAuthenticateHook = {
  authenticate(
    request: AuthenticateRequest<{ readonly internalToken?: string }>,
  ): AuthenticateResult<{ service: ServiceName; userId: string }, Unauthenticated> {
    recordHookCall(authenticateHookName("service"), request.operation);

    const service = SERVICES_BY_TOKEN.get(request.credentials.internalToken ?? "");

    return service === undefined ? UNAUTHENTICATED : { principal: { service, userId: USER_ID } };
  },
};

/** The `stripe` identity: the signed request verified with `@seampact/signed-webhooks`. */
export const stripeAuthenticateHook = {
  async authenticate(
    request: AuthenticateRequest<object>,
  ): Promise<AuthenticateResult<{ account: string }, Unauthenticated>> {
    recordHookCall(authenticateHookName("stripe"), request.operation);

    const signature = request.signature;

    if (signature?.verify !== "template") return UNAUTHENTICATED;

    const verification = await verifyTemplateSignature(signature, (keyId) =>
      keyId === STRIPE_KEY_ID ? [STRIPE_SECRET] : [],
    );

    return verification.verified ? { principal: { account: STRIPE_ACCOUNT } } : UNAUTHENTICATED;
  },
};

/** The `tasks` api's decider: denies what the script denies, else the throttle rule for the throttled user. */
export const tasksDeciderHook = {
  decide(request: RequirementRequest): Decision<TasksDenial> {
    recordHookCall(decideHookName(request.name), request.operation);

    assertRolesRequestComplete(request);

    const scripted = scriptedDecision(request.name, request.purpose.kind);

    if (scripted !== undefined) return { deny: tasksDenial(scripted) };

    if (request.name === THROTTLE_RULE && userIdOf(request.principal) === THROTTLED_USER_ID) {
      return {
        deny: { code: "api.rate_limited", params: { retryAfterMs: THROTTLE_RETRY_AFTER_MS } },
      };
    }

    return { allow: true };
  },
};

/** The `tasksService` api's decider: denies what the script denies, else `callerService` for an unlisted service. */
export const serviceDeciderHook = {
  decide(request: RequirementRequest): Decision<Forbidden> {
    recordHookCall(decideHookName(request.name), request.operation);

    const scripted = scriptedDecision(request.name, request.purpose.kind);

    if (scripted !== undefined) return { deny: forbiddenDenial(scripted) };

    if (request.name === CALLER_SERVICE_RIGHT && !callerServiceAllowed(request)) {
      return { deny: FORBIDDEN };
    }

    return { allow: true };
  },
};

/** Resolves a declared scope id to itself, every channel existing, unless the script denies the scope. */
export const scopeResolverHook = {
  resolveScope(request: ResolveScopeRequest): ScopeResolution<ResolvedScope, NotFound> {
    if (request.source.resolver !== "declared") {
      throw new Error(`the consumer resolves declared scope ids only, not '${request.scope}'`);
    }

    const scripted = scriptedScopeDenial(request.scope);

    if (scripted !== undefined) return { deny: notFoundDenial(scripted) };

    return { resolved: { scope: request.scope, id: request.source.id } };
  },
};

export function createIdempotencyStore(): IdempotencyStore {
  return createMemoryIdempotencyStore();
}

/** Writes each unexpected failure to the captured log lines, as an app's error reporter would. */
export function logUnexpectedError(
  exceptionOrReply: unknown,
  context: { readonly api: string; readonly operation: string | undefined },
): void {
  const reason = exceptionOrReply instanceof Error ? exceptionOrReply.message : "a reply";

  writeLogLine(`unexpected failure in ${context.api}.${context.operation ?? "(none)"}: ${reason}`);
}

// A scripted denial is one of the api's decide codes; another code is a fault of the case.
function tasksDenial(denial: ScriptedDenial): TasksDenial {
  switch (denial.code) {
    case "api.forbidden":
      return FORBIDDEN;
    case "api.not_found":
    case "api.reauthentication_required":
      return { code: denial.code };
    case "api.rate_limited":
      return { code: denial.code, params: { retryAfterMs: THROTTLE_RETRY_AFTER_MS } };
    default:
      throw new Error(
        `the script denies with '${denial.code}', which no decide hook of the tasks api declares`,
      );
  }
}

function forbiddenDenial(denial: ScriptedDenial): Forbidden {
  if (denial.code !== "api.forbidden") {
    throw new Error(
      `the script denies with '${denial.code}'; the tasksService api's decide hooks declare api.forbidden`,
    );
  }

  return FORBIDDEN;
}

function notFoundDenial(denial: ScriptedDenial): NotFound {
  if (denial.code !== "api.not_found") {
    throw new Error(
      `the script denies a scope with '${denial.code}'; the reference contract's channel scope declares api.not_found`,
    );
  }

  return { code: denial.code };
}

// The boundary must hand a `roles` decide request its `allowed` param and its scope subject; a double that
// answered without them would let a boundary that drops them pass.
function assertRolesRequestComplete(request: RequirementRequest): void {
  if (request.name !== ROLES_RIGHT) return;

  const { params } = request;
  const hasAllowed =
    typeof params === "object" &&
    params !== null &&
    "allowed" in params &&
    Array.isArray(params.allowed);

  if (!hasAllowed || request.subject === undefined) {
    throw new Error(
      `the '${ROLES_RIGHT}' decide request lacks its 'allowed' param or its scope subject: the boundary dropped them`,
    );
  }
}

function callerServiceAllowed(request: RequirementRequest): boolean {
  const { params, principal } = request;

  if (typeof params !== "object" || params === null || !("allowed" in params)) return false;

  if (typeof principal !== "object" || principal === null || !("service" in principal)) {
    return false;
  }

  return Array.isArray(params.allowed) && params.allowed.includes(principal.service);
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
    deciders: [{ names: "all" as const, decider: tasksDeciderHook }],
    scopeResolvers: { channel: scopeResolverHook },
    idempotencyStore: createIdempotencyStore(),
    onUnexpectedError: logUnexpectedError,
  };
}

/** The `tasksService` api's hooks, as every overlay registers them. */
export function tasksServiceHooks() {
  return {
    authenticate: { service: serviceAuthenticateHook },
    deciders: [{ names: "all" as const, decider: serviceDeciderHook }],
    scopeResolvers: {},
    onUnexpectedError: logUnexpectedError,
  };
}
