// Steps 2 to 5 of the check order (ADR 0012): authenticate, scopes outermost first, then requirements in declared
// order, each hook call wrapped. Principal requirements and bindings are refused by the generator until a
// contract needs them. Copied into the generated tree as is.
import { createHash } from "node:crypto";
import type {
  AuthenticateRequest,
  OperationRef,
  Purpose,
  RequestView,
  RequirementRequest,
  ResolvedScope,
  SubjectRef,
  ThrottleBucket,
} from "@seampact/hooks";
import {
  type BoundaryHooks,
  callHook,
  deciderFor,
  type FrameworkDenialTest,
} from "./boundary-hooks.js";
import { ContractError, codeOfRole, isPlainObject, unexpectedError } from "./contract-error.js";
import {
  type AccessEntry,
  type ContractApi,
  type ContractRequest,
  type ContractRoute,
  headerValue,
  headerValues,
  type SubjectEntry,
  type ValueSource,
} from "./contract-route.js";
import { parseSignatureHeader } from "./signature-header.js";

/** What every check step reads: the api, the matched route, the request and the registered hooks. */
export interface CheckState {
  readonly api: ContractApi;
  readonly route: ContractRoute;
  readonly request: ContractRequest;
  /** Path params as matched, still percent-encoded. */
  readonly pathParams: Readonly<Record<string, string>>;
  readonly hooks: BoundaryHooks;
  readonly isFrameworkDenial: FrameworkDenialTest;
}

/** The caller once steps 2 to 5 passed: the principal (null when anonymous) and the resolved scopes. */
export interface AccessGrant {
  readonly identity?: string;
  readonly principal: unknown;
  readonly scopes: readonly ResolvedScope[];
}

const UNAUTHENTICATED_ROLE = "unauthenticated";
const BEARER_PREFIX = /^Bearer[ ]+/i;
const COOKIE_SEPARATOR = ";";

/** Steps 2 to 5; throws a `ContractError` at the first refusal. */
export async function authorizeRequest(state: CheckState): Promise<AccessGrant> {
  const authenticated = await authenticate(state);
  const scopes = await resolveScopes(state, authenticated.principal);
  const grant: AccessGrant = { ...authenticated, scopes };

  for (const requirement of state.route.requires) {
    const decision = await decide(state, grant, {
      kind: requirement.kind,
      name: requirement.name,
      params: requirement.params,
      subject: requirement.subject,
      proof: requirement.proof,
      bucket: requirement.bucket,
      errors: requirement.errors,
      purpose: { kind: "route" },
    });

    if (decision !== undefined) throw decision;
  }

  return grant;
}

/** The operation as hooks receive it. */
export function operationRef(state: CheckState): OperationRef {
  return { kind: "httpOperation", api: state.api.id, id: state.route.id };
}

/** The read-only request view every hook receives. */
export function requestView(state: CheckState): RequestView {
  const { request } = state;

  return {
    method: request.method,
    path: request.path,
    headers: headerValues(request.headers),
    ...(request.clientAddress === undefined ? {} : { clientAddress: request.clientAddress }),
  };
}

async function authenticate(state: CheckState): Promise<Omit<AccessGrant, "scopes">> {
  const access: AccessEntry = state.route.access;

  if (access.kind === "public") return { principal: null };

  const hook = state.hooks.authenticate[access.identity];

  if (hook === undefined) {
    throw unexpectedError(
      state.route,
      new Error(`no authenticate hook is registered for the identity '${access.identity}'`),
    );
  }

  const request = authenticateRequest(state, access);

  if (request === undefined) {
    if (access.anonymousAllowed && access.signed === undefined) return { principal: null };

    throw new ContractError(unauthenticatedCode(state.route));
  }

  const result: unknown = await callHook(() => hook.authenticate(request), {
    route: state.route,
    isFrameworkDenial: state.isFrameworkDenial,
  });

  if (isPlainObject(result) && "principal" in result && !("deny" in result)) {
    return { identity: access.identity, principal: result.principal };
  }

  throw denialOf(state.route, result, declaredCodes(state.route));
}

// Undefined when the request carries none of the identity's credentials, or a malformed signature header.
function authenticateRequest(
  state: CheckState,
  access: Extract<AccessEntry, { kind: "identity" }>,
): AuthenticateRequest | undefined {
  const base = {
    identity: access.identity,
    request: requestView(state),
    operation: operationRef(state),
    extensions: {},
  };

  if (access.signed !== undefined) {
    const rawBody = state.request.rawBody;

    if (rawBody === undefined) {
      throw unexpectedError(state.route, new Error(missingRawBodyMessage(state)));
    }

    const parsed = parseSignatureHeader(
      access.signed.format,
      headerValue(state.request.headers, access.signed.header),
    );

    if (parsed === undefined) return undefined;

    return {
      ...base,
      credentials: {},
      signature: {
        verify: "template",
        rawBody,
        ...(parsed.timestamp === undefined ? {} : { timestamp: parsed.timestamp }),
        candidateSignatures: parsed.candidateSignatures,
        keyId: access.signed.keyId,
        template: access.signed.template,
      },
    };
  }

  const credentials: Record<string, string> = {};
  let byCookie = false;

  for (const source of access.credentials) {
    const value = credentialValue(state.request, source.in, source.name);

    if (value === undefined) continue;

    credentials[source.scheme] = value;
    byCookie ||= source.in === "cookie";
  }

  if (Object.keys(credentials).length === 0) return undefined;

  const csrfToken =
    byCookie && !state.route.safe && access.csrfHeader !== undefined
      ? headerValue(state.request.headers, access.csrfHeader)
      : undefined;

  return { ...base, credentials, ...(csrfToken === undefined ? {} : { csrfToken }) };
}

function missingRawBodyMessage(state: CheckState): string {
  return (
    `seampact: operation '${state.route.id}' (${state.route.method.toUpperCase()} ${state.route.path}) is signed ` +
    "but the request has no raw body as a Buffer on req.rawBody. Create the app with { rawBody: true }, or pass " +
    "the generated keepRawBody as the JSON parser's verify function with rawBody off."
  );
}

function credentialValue(
  request: ContractRequest,
  location: "bearer" | "cookie" | "header",
  name: string | undefined,
): string | undefined {
  if (location === "bearer") {
    const authorization = headerValue(request.headers, "authorization");

    return authorization !== undefined && BEARER_PREFIX.test(authorization)
      ? authorization.replace(BEARER_PREFIX, "")
      : undefined;
  }

  if (name === undefined) return undefined;

  if (location === "header") return headerValue(request.headers, name);

  return cookieValue(headerValue(request.headers, "cookie"), name);
}

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (cookieHeader === undefined) return undefined;

  for (const pair of cookieHeader.split(COOKIE_SEPARATOR)) {
    const separator = pair.indexOf("=");

    if (separator > 0 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }

  return undefined;
}

function unauthenticatedCode(route: ContractRoute): string {
  const code = codeOfRole(route, UNAUTHENTICATED_ROLE);

  if (code === undefined) {
    throw unexpectedError(
      route,
      new Error(`operation '${route.id}' declares no unauthenticated code`),
    );
  }

  return code;
}

async function resolveScopes(state: CheckState, principal: unknown): Promise<ResolvedScope[]> {
  const resolved: ResolvedScope[] = [];

  for (const scope of state.route.scopes) {
    const hook = state.hooks.scopeResolvers[scope.scope];

    if (hook === undefined) {
      throw unexpectedError(state.route, new Error(`no scope resolver for '${scope.scope}'`));
    }

    const id = sourceValue(state, scope.source, { principal, scopes: resolved });
    const result: unknown = await callHook(
      () =>
        hook.resolveScope({
          scope: scope.scope,
          source: { resolver: "declared", id },
          principal,
          outerScopes: [...resolved],
          extensions: { scope: {}, operation: {} },
        }),
      { route: state.route, isFrameworkDenial: state.isFrameworkDenial },
    );

    if (isPlainObject(result) && "resolved" in result && !("deny" in result)) {
      const value = result.resolved;

      if (!isPlainObject(value) || typeof value.scope !== "string") {
        throw unexpectedError(
          state.route,
          new Error(`the resolver of '${scope.scope}' answered no scope`),
        );
      }

      resolved.push({
        scope: value.scope,
        id: value.id,
        ...("value" in value ? { value: value.value } : {}),
      });
      continue;
    }

    throw denialOf(state.route, result, scope.errors);
  }

  return resolved;
}

/** One requirement asked of its decider: undefined when allowed, else the denial to raise. */
export interface DecideQuestion {
  readonly kind: "right" | "rule";
  readonly name: string;
  readonly params?: unknown | undefined;
  readonly subject?: SubjectEntry | undefined;
  readonly proof?: string | undefined;
  readonly bucket?:
    | undefined
    | {
        readonly id: string;
        readonly key: readonly ValueSource[];
        readonly limit?: number;
        readonly windowMs?: number;
      };
  readonly errors: readonly string[];
  readonly purpose: Purpose;
  /** The holder object of an output field, the subject's record. */
  readonly holder?: Readonly<Record<string, unknown>> | undefined;
}

export async function decide(
  state: CheckState,
  grant: AccessGrant,
  question: DecideQuestion,
): Promise<ContractError | undefined> {
  const decider = deciderFor(state.hooks, question.name);

  if (decider === undefined) {
    return unexpectedError(
      state.route,
      new Error(`no decider is registered for '${question.name}'`),
    );
  }

  const request: RequirementRequest = {
    kind: question.kind,
    name: question.name,
    ...(question.params === undefined ? {} : { params: question.params }),
    principal: grant.principal ?? null,
    ...subjectMember(state, grant, question),
    scopes: grant.scopes,
    ...(question.proof === undefined
      ? {}
      : { proof: bodyMember(state.request.body, question.proof) }),
    ...(question.bucket === undefined
      ? {}
      : { bucket: throttleBucket(state, grant, question.bucket) }),
    purpose: question.purpose,
    operation: operationRef(state),
    request: requestView(state),
    extensions: { requirement: {}, operation: {} },
  };
  const decision: unknown = await callHook(() => decider.decide(request), {
    route: state.route,
    isFrameworkDenial: state.isFrameworkDenial,
    ...(question.errors[0] === undefined ? {} : { denialCode: question.errors[0] }),
  });

  if (isPlainObject(decision) && decision.allow === true && !("deny" in decision)) return undefined;

  return denialOf(state.route, decision, question.errors);
}

function subjectMember(
  state: CheckState,
  grant: AccessGrant,
  question: DecideQuestion,
): { subject?: SubjectRef } {
  if (question.subject === undefined) return {};

  const id = sourceValue(state, question.subject.source, grant, question.holder);

  return {
    subject: {
      type: question.subject.type,
      id,
      ...(question.holder === undefined ? {} : { record: question.holder }),
    },
  };
}

function throttleBucket(
  state: CheckState,
  grant: AccessGrant,
  bucket: NonNullable<DecideQuestion["bucket"]>,
): ThrottleBucket {
  const values = bucket.key.map((source) => sourceValue(state, source, grant));

  return {
    id: bucket.id,
    key: createHash("sha256")
      .update(JSON.stringify([state.api.id, bucket.id, values]))
      .digest("hex"),
    values,
    ...(bucket.limit === undefined ? {} : { limit: bucket.limit }),
    ...(bucket.windowMs === undefined ? {} : { windowMs: bucket.windowMs }),
  };
}

function sourceValue(
  state: CheckState,
  source: ValueSource,
  grant: { readonly principal: unknown; readonly scopes: readonly ResolvedScope[] },
  holder?: Readonly<Record<string, unknown>>,
): unknown {
  switch (source.in) {
    case "path": {
      const raw = state.pathParams[source.name];

      return raw === undefined ? undefined : decodeURIComponent(raw);
    }

    case "scope":
      return grant.scopes.find((scope) => scope.scope === source.name)?.id;
    case "principal":
      return isPlainObject(grant.principal) ? grant.principal[source.name] : undefined;
    case "holderField":
      return holder?.[source.name];
  }
}

function bodyMember(body: unknown, name: string): unknown {
  return isPlainObject(body) ? body[name] : undefined;
}

// A hook's denial naming a declared code; anything else (an undeclared code, both arms, neither) is a 500.
function denialOf(
  route: ContractRoute,
  result: unknown,
  declared: readonly string[],
): ContractError {
  if (
    isPlainObject(result) &&
    "deny" in result &&
    !("principal" in result) &&
    !("resolved" in result) &&
    !("allow" in result)
  ) {
    const deny = result.deny;

    if (isPlainObject(deny) && typeof deny.code === "string" && declared.includes(deny.code)) {
      return new ContractError(deny.code, deny.params);
    }
  }

  return unexpectedError(
    route,
    new Error(
      `a hook of operation '${route.id}' answered ${JSON.stringify(result)}, not one of its declared answers`,
    ),
  );
}

function declaredCodes(route: ContractRoute): string[] {
  return Object.keys(route.errors);
}
