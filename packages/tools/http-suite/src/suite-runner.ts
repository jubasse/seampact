// Runs cases against a sample app at a base URL, one step after another, and answers the suite report.
import { loadScript, readHookCalls } from "./control-routes.js";
import { signRequestBody } from "./request-signature.js";
import { checkResponse, type ReceivedResponse, readPointer } from "./response-check.js";
import type { CaptureSource, JsonValue, SuiteCase, SuiteProfile, SuiteStep } from "./suite-case.js";
import { type CaseResult, type SuiteReport, suiteReportOf } from "./suite-report.js";
import { TemplateError, TemplateScope } from "./template.js";

/**
 * The credentials the sample app's hooks honour, read by the cases as `{{userToken}}`, `{{throttledUserToken}}`,
 * `{{serviceJwt}}`, `{{foreignServiceJwt}}`, `{{stripeSecret}}`, `{{throttleRetryAfterMs}}` and the derived
 * `{{throttleRetryAfterSeconds}}`.
 */
export interface SuiteCredentials {
  readonly userToken: string;
  readonly throttledUserToken: string;
  readonly serviceJwt: string;
  readonly stripeSecret: string;
  readonly throttleRetryAfterMs: number;
  /** The bearer token of a service the service api's `callerService` requirement does not allow. */
  readonly foreignServiceJwt: string;
}

export interface SuiteRunOptions {
  readonly baseUrl: string;
  /** The server target the sample app was built with, as the report names it. */
  readonly target: string;
  readonly profile: SuiteProfile;
  readonly credentials: SuiteCredentials;
  readonly cases: readonly SuiteCase[];
  /** Cases the sample app does not run, by case id, with the reason the report names. */
  readonly refusals?: Readonly<Record<string, string>>;
  readonly requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MILLISECONDS_PER_SECOND = 1000;
const JSON_MEDIA = "application/json";
const BOOT_PROFILE = "boot";

interface RunContext {
  readonly baseUrl: string;
  readonly variables: Readonly<Record<string, JsonValue>>;
  readonly requestTimeoutMs: number;
}

export async function runSuite(options: SuiteRunOptions): Promise<SuiteReport> {
  const refusals = options.refusals ?? {};

  if (options.profile === BOOT_PROFILE) {
    throw new Error(
      "http-suite: the boot profile sends no request; run its cases with runBootSuite",
    );
  }

  refuseForeignCases(options.cases, options.profile);
  refuseUnknownRefusals(options.cases, refusals);

  const context: RunContext = {
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    variables: variablesOf(options.credentials),
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  };
  const results: CaseResult[] = [];

  for (const suiteCase of options.cases) {
    const reason = refusals[suiteCase.id];

    results.push(
      reason === undefined ? await runCase(suiteCase, context) : refusedResult(suiteCase, reason),
    );
  }

  return suiteReportOf({ target: options.target, profile: options.profile }, results);
}

/** Throws when a case does not run in `profile`. */
export function refuseForeignCases(cases: readonly SuiteCase[], profile: SuiteProfile): void {
  const foreign = cases.filter((suiteCase) => !suiteCase.profiles.includes(profile));

  if (foreign.length > 0) {
    throw new Error(
      `http-suite: the cases ${foreign.map((suiteCase) => suiteCase.id).join(", ")} do not run in the '${profile}' profile`,
    );
  }
}

/** Throws when a refusal names a case the run does not hold, so a stale refusal is removed. */
export function refuseUnknownRefusals(
  cases: readonly SuiteCase[],
  refusals: Readonly<Record<string, string>>,
): void {
  const ids = new Set(cases.map((suiteCase) => suiteCase.id));
  const unknown = Object.keys(refusals).filter((id) => !ids.has(id));

  if (unknown.length > 0) {
    throw new Error(
      `http-suite: refusals name cases this run does not hold: ${unknown.join(", ")}`,
    );
  }
}

function variablesOf(credentials: SuiteCredentials): Record<string, JsonValue> {
  return {
    ...credentials,
    // `Retry-After` carries the delay in whole seconds, rounded up.
    throttleRetryAfterSeconds: String(
      Math.ceil(credentials.throttleRetryAfterMs / MILLISECONDS_PER_SECOND),
    ),
  };
}

export function refusedResult(suiteCase: SuiteCase, reason: string): CaseResult {
  return { ...caseHeader(suiteCase), outcome: "refused", failures: [], reason };
}

export function caseHeader(suiteCase: SuiteCase): Pick<CaseResult, "id" | "title" | "checks"> {
  return { id: suiteCase.id, title: suiteCase.title, checks: [...suiteCase.checks] };
}

async function runCase(suiteCase: SuiteCase, context: RunContext): Promise<CaseResult> {
  const scope = new TemplateScope(context.variables);
  const failures: string[] = [];

  try {
    await loadScript(context.baseUrl, suiteCase.script ?? {}, timeoutSignal(context));

    for (const [index, step] of suiteCase.steps.entries()) {
      const label = `step ${index} (${step.title ?? `${step.request.method} ${step.request.path}`})`;

      failures.push(
        ...(await runStep(step, scope, context)).map((failure) => `${label}: ${failure}`),
      );
    }

    if (suiteCase.hookCalls !== undefined) {
      failures.push(...(await checkHookCalls(suiteCase, context)));
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  return {
    ...caseHeader(suiteCase),
    outcome: failures.length === 0 ? "passed" : "failed",
    failures,
  };
}

async function checkHookCalls(suiteCase: SuiteCase, context: RunContext): Promise<string[]> {
  const recorded = await readHookCalls(context.baseUrl, timeoutSignal(context));
  const expected = JSON.stringify(suiteCase.hookCalls);
  const actual = JSON.stringify(recorded);

  return expected === actual ? [] : [`hook calls ${actual}, expected ${expected}`];
}

async function runStep(
  step: SuiteStep,
  scope: TemplateScope,
  context: RunContext,
): Promise<string[]> {
  const response = await send(step, scope, context);
  const failures: string[] = [];

  for (const [name, source] of Object.entries(step.capture ?? {})) {
    const value = capturedValue(source, response);

    if (value === undefined)
      failures.push(`capture '${name}': the response holds no ${JSON.stringify(source)}`);
    else scope.capture(name, value);
  }

  // The status often explains a failed capture, so the expectation is checked and reported too.
  try {
    return [...failures, ...checkResponse(filledExpectation(step, scope), response)];
  } catch (error) {
    if (failures.length === 0 || !(error instanceof TemplateError)) throw error;

    return [...failures, error.message];
  }
}

function capturedValue(source: CaptureSource, response: ReceivedResponse): JsonValue | undefined {
  if ("body" in source) {
    return response.json === undefined ? undefined : readPointer(response.json, source.body);
  }

  return new RegExp(source.pattern).exec(response.headers.get(source.header) ?? "")?.[1];
}

function filledExpectation(step: SuiteStep, scope: TemplateScope): SuiteStep["expect"] {
  const { headers, body, bodyText } = step.expect;

  return {
    ...step.expect,
    ...(headers === undefined
      ? {}
      : {
          headers: Object.fromEntries(
            Object.entries(headers).map(([name, expectation]) => [
              name,
              {
                ...expectation,
                ...(expectation.equals === undefined
                  ? {}
                  : { equals: scope.fillText(expectation.equals) }),
                ...(expectation.contains === undefined
                  ? {}
                  : { contains: expectation.contains.map((part) => scope.fillText(part)) }),
                ...(expectation.excludes === undefined
                  ? {}
                  : { excludes: scope.fillText(expectation.excludes) }),
              },
            ]),
          ),
        }),
    ...(body === undefined ? {} : { body: scope.fill(body) }),
    ...(bodyText === undefined ? {} : { bodyText: scope.fillText(bodyText) }),
  };
}

async function send(
  step: SuiteStep,
  scope: TemplateScope,
  context: RunContext,
): Promise<ReceivedResponse> {
  const { request } = step;
  const headers = new Headers(
    Object.entries(request.headers ?? {}).map(([name, value]) => [name, scope.fillText(value)]),
  );
  const body = bodyOf(request, scope);

  if (body !== undefined && !headers.has("content-type")) headers.set("content-type", JSON_MEDIA);

  if (request.sign !== undefined) {
    const signed = body ?? "";

    headers.set(
      request.sign.header,
      signRequestBody(
        request.sign.scheme,
        scope.fillText(request.sign.secret),
        signed,
        Date.now() - (request.sign.ageSeconds ?? 0) * MILLISECONDS_PER_SECOND,
      ),
    );
  }

  const answer = await fetch(
    `${context.baseUrl}${scope.fillText(request.path)}${queryOf(request.query, request.path, scope)}`,
    {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "manual",
      signal: timeoutSignal(context),
    },
  );
  const text = await answer.text();

  return { status: answer.status, headers: answer.headers, text, json: parseJson(text) };
}

function bodyOf(request: SuiteStep["request"], scope: TemplateScope): string | undefined {
  if (request.bodyText !== undefined) return scope.fillText(request.bodyText);

  return request.body === undefined ? undefined : JSON.stringify(scope.fill(request.body));
}

function queryOf(
  query: Readonly<Record<string, JsonValue>> | undefined,
  path: string,
  scope: TemplateScope,
): string {
  if (query === undefined) return "";

  const parameters = new URLSearchParams();

  for (const [name, value] of Object.entries(query)) {
    const filled = scope.fill(value);

    parameters.append(name, typeof filled === "string" ? filled : JSON.stringify(filled));
  }

  return `${path.includes("?") ? "&" : "?"}${parameters.toString()}`;
}

function parseJson(text: string): JsonValue | undefined {
  if (text === "") return undefined;

  try {
    const parsed: JsonValue = JSON.parse(text);

    return parsed;
  } catch {
    // A body that is not JSON is checked as text; a `body` expectation on it fails by name.
    return undefined;
  }
}

function timeoutSignal(context: RunContext): AbortSignal {
  return AbortSignal.timeout(context.requestTimeoutMs);
}
