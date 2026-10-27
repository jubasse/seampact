// Steps 2 to 5 of the check order (ADR 0012): authenticate with the principal validated against its schema, scopes
// outermost first with each id validated, then requirements in declared order with each body proof validated, each
// hook call wrapped. Principal requirements and bindings are refused by the generator until a contract needs them.
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
import { ContractError, codeOfRole, roleError, unexpectedError } from "./contract-error.js";
import {
  type AccessEntry,
  type ContractApi,
  type ContractRequest,
  type ContractRoute,
  headerValue,
  headerValues,
  type RequirementEntry,
  type SubjectEntry,
  type ValueSource,
} from "./contract-route.js";
import {
  issuePointer,
  issuesOnMember,
  type RequestValidation,
  schemaInvalidError,
  validateRequest,
} from "./input-issues.js";
import { isPlainObject } from "./plain-object.js";
import { sha256Hex } from "./sha256.js";
import { parseSignatureHeader } from "./signature-header.js";
import type { PlatformFixes } from "./transport-checks.js";
import { decodePathParam } from "./wire-decoding.js";

/** What every check step reads: the api, the matched route, the request and the registered hooks. */
export interface CheckState {
  readonly api: ContractApi;
  readonly route: ContractRoute;
  readonly request: ContractRequest;
  /** Path params as matched, still percent-encoded. */
  readonly pathParams: Readonly<Record<string, string>>;
  readonly hooks: BoundaryHooks;
  readonly isFrameworkDenial: FrameworkDenialTest;
  readonly fixes: PlatformFixes;
}

/**
 * The caller once steps 2 to 5 passed: the principal (null when anonymous), the resolved scopes, and the request
 * validation a scope id, a body proof or a path subject needed, which step 6 reuses.
 */
export interface AccessGrant {
  readonly identity?: string;
  readonly principal: unknown;
  readonly scopes: readonly ResolvedScope[];
  readonly validation?: RequestValidation;
}

const UNAUTHENTICATED_ROLE = "unauthenticated";
const CSRF_INVALID_ROLE = "csrfInvalid";
const BEARER_PREFIX = /^Bearer[ ]+/i;
const COOKIE_SEPARATOR = ";";

/** Steps 2 to 5; throws a `ContractError` at the first refusal. */
export async function authorizeRequest(state: CheckState): Promise<AccessGrant> {
  const once = onceValidated(state);
  const validation = once.validation;
  const authenticated = await authenticate(state);
  const scopes = await resolveScopes(state, authenticated.principal, validation);
  const grant: AccessGrant = { ...authenticated, scopes };

  for (const requirement of state.route.requires) {
    const proof =
      requirement.proof === undefined
        ? undefined
        : { value: validatedMember(state, await validation(), "body", requirement.proof) };
    const pathValues = await validatedPathValues(state, requirement, validation);
    const decision = await decide(state, grant, {
      kind: requirement.kind,
      name: requirement.name,
      params: requirement.params,
      subject: requirement.subject,
      proof,
      bucket: requirement.bucket,
      errors: requirement.errors,
      purpose: { kind: "route" },
      pathValues,
    });

    if (decision !== undefined) throw decision;
  }

  const validated = await once.settled();

  return validated === undefined ? grant : { ...grant, validation: validated };
}

interface OnceValidated {
  readonly validation: () => Promise<RequestValidation>;
  /** The validation when a step asked for it, else undefined. */
  readonly settled: () => Promise<RequestValidation | undefined>;
}

// The request validated at most once, and only when a scope id or a body proof needs it before step 6.
function onceValidated(state: CheckState): OnceValidated {
  let pending: Promise<RequestValidation> | undefined;

  return {
    validation: () => {
      pending ??= validateRequest(state);

      return pending;
    },
    settled: async () => pending,
  };
}

// The path params a requirement's subject id or bucket key reads, each validated before its decider sees it.
async function validatedPathValues(
  state: CheckState,
  requirement: RequirementEntry,
  validation: () => Promise<RequestValidation>,
): Promise<Record<string, unknown>> {
  const sources = [
    ...(requirement.subject === undefined ? [] : [requirement.subject.source]),
    ...(requirement.bucket?.key ?? []),
  ];
  const pathValues: Record<string, unknown> = {};

  for (const source of sources) {
    if (source.in !== "path") continue;

    pathValues[source.name] = validatedMember(state, await validation(), "path", source.name);
  }

  return pathValues;
}

// A member a hook receives before step 6: its issues answer the `schemaInvalid` 400 now, else its value, the
// validator's output when the whole request passed, the decoded value when only other members failed.
function validatedMember(
  state: CheckState,
  validation: RequestValidation,
  part: "path" | "body",
  member: string,
): unknown {
  const issues = issuesOnMember(validation, part, member);

  if (issues.length > 0) throw schemaInvalidError(state.route, issues);

  const request = validation.issues.length === 0 ? validation.value : validation.candidate;
  const values = isPlainObject(request) ? request[part] : undefined;

  // A copy, since step 6 reuses this validation: a hook that changes its value never reaches the handler input.
  return isPlainObject(values) ? structuredClone(values[member]) : undefined;
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

  // A missing principal authenticates no one: the answer falls to the 500 of an undeclared answer.
  if (
    isPlainObject(result) &&
    !("deny" in result) &&
    result.principal !== undefined &&
    result.principal !== null
  ) {
    return {
      identity: access.identity,
      principal: await validatedPrincipal(state, access, result.principal),
    };
  }

  throw denialOf(state.route, result, declaredCodes(state.route));
}

// A principal off its schema is the app's bug: a 500 reported to the hook, never a caller let in.
async function validatedPrincipal(
  state: CheckState,
  access: Extract<AccessEntry, { kind: "identity" }>,
  principal: unknown,
): Promise<unknown> {
  const result = await access.principalValidator["~standard"].validate(principal);

  if (result.issues === undefined) return result.value;

  const pointers = result.issues.map((issue) => `'${issuePointer(issue)}'`).join(", ");

  throw unexpectedError(
    state.route,
    new Error(
      `the authenticate hook of the identity '${access.identity}' answered a principal that does not match ` +
        `its schema '${access.principalSchema}' (issues at ${pointers}). Return a principal of that schema.`,
    ),
  );
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
  let byOtherLocation = false;

  for (const source of access.credentials) {
    const value = credentialValue(state.request, source.in, source.name);

    if (value === undefined) continue;

    credentials[source.scheme] = value;
    byCookie ||= source.in === "cookie";
    byOtherLocation ||= source.in !== "cookie";
  }

  if (Object.keys(credentials).length === 0) return undefined;

  const csrfToken =
    byCookie && !state.route.safe && access.csrfHeader !== undefined
      ? headerValue(state.request.headers, access.csrfHeader)
      : undefined;

  // The boundary refuses a cookie-only write without its CSRF value; the hook still checks the value itself.
  if (
    byCookie &&
    !byOtherLocation &&
    !state.route.safe &&
    access.csrfHeader !== undefined &&
    (csrfToken === undefined || csrfToken === "")
  ) {
    throw roleError(state.route, CSRF_INVALID_ROLE);
  }

  return { ...base, credentials, ...(csrfToken === undefined ? {} : { csrfToken }) };
}

function missingRawBodyMessage(state: CheckState): string {
  return (
    `seampact: operation '${state.route.id}' (${state.route.method.toUpperCase()} ${state.route.path}) is signed ` +
    `but the request has no raw body. ${state.fixes.rawBody}`
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

async function resolveScopes(
  state: CheckState,
  principal: unknown,
  validation: () => Promise<RequestValidation>,
): Promise<ResolvedScope[]> {
  const resolved: ResolvedScope[] = [];

  for (const scope of state.route.scopes) {
    const hook = state.hooks.scopeResolvers[scope.scope];

    if (hook === undefined) {
      throw unexpectedError(state.route, new Error(`no scope resolver for '${scope.scope}'`));
    }

    // The route table reads a scope id from a path param only, so the operation's validator checks it.
    if (scope.source.in !== "path") {
      throw unexpectedError(
        state.route,
        new Error(
          `the scope '${scope.scope}' reads its id from '${scope.source.in}', not a path param`,
        ),
      );
    }

    const id = validatedMember(state, await validation(), "path", scope.source.name);
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

      if (value.scope !== scope.scope) {
        throw unexpectedError(
          state.route,
          new Error(`the resolver of '${scope.scope}' answered the scope '${value.scope}'`),
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
  /** The rule's body proof, validated against its field schema. */
  readonly proof?: { readonly value: unknown } | undefined;
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
  /** Path params already validated before step 6, read in place of the decoded wire value. */
  readonly pathValues?: Readonly<Record<string, unknown>> | undefined;
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
    ...(question.proof === undefined ? {} : { proof: question.proof.value }),
    ...(question.bucket === undefined
      ? {}
      : { bucket: await throttleBucket(state, grant, question.bucket, question) }),
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

  const id = sourceValue(state, question.subject.source, grant, question);

  return {
    subject: {
      type: question.subject.type,
      id,
      ...(question.holder === undefined ? {} : { record: question.holder }),
    },
  };
}

async function throttleBucket(
  state: CheckState,
  grant: AccessGrant,
  bucket: NonNullable<DecideQuestion["bucket"]>,
  question: DecideQuestion,
): Promise<ThrottleBucket> {
  const values = bucket.key.map((source) => sourceValue(state, source, grant, question));

  return {
    id: bucket.id,
    key: await sha256Hex(JSON.stringify([state.api.id, bucket.id, values])),
    values,
    ...(bucket.limit === undefined ? {} : { limit: bucket.limit }),
    ...(bucket.windowMs === undefined ? {} : { windowMs: bucket.windowMs }),
  };
}

function sourceValue(
  state: CheckState,
  source: ValueSource,
  grant: { readonly principal: unknown; readonly scopes: readonly ResolvedScope[] },
  question: Pick<DecideQuestion, "holder" | "pathValues">,
): unknown {
  switch (source.in) {
    case "path": {
      if (question.pathValues !== undefined && Object.hasOwn(question.pathValues, source.name)) {
        return question.pathValues[source.name];
      }

      const raw = state.pathParams[source.name];

      return raw === undefined ? undefined : decodePathParam(raw);
    }

    case "scope":
      return grant.scopes.find((scope) => scope.scope === source.name)?.id;
    case "principal":
      return isPlainObject(grant.principal) ? grant.principal[source.name] : undefined;
    case "holderField":
      return question.holder?.[source.name];
  }
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
