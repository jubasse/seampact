// Runs cases against a sample app at a base URL, one step after another, and answers the suite report.
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { setTimeout } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { BOOT_PROFILE } from "./boot-variant.js";
import { loadScript, readHookCalls, readLogLines } from "./control-routes.js";
import type { FormatReader } from "./format-reader.js";
import { checkLogLines } from "./log-lines-check.js";
import type { SentRequest } from "./operation-match.js";
import type { RecordedHookCall } from "./recorded-hook-call.js";
import { signRequestBody } from "./request-signature.js";
import { checkResponse, type ReceivedResponse, readPointer } from "./response-check.js";
import { checkIdsForTarget } from "./scoped-check.js";
import {
  type CaptureSource,
  isScriptStep,
  type JsonValue,
  outsideTargetsReason,
  runsInProfile,
  type SuiteCase,
  type SuiteProfile,
  type SuiteStep,
} from "./suite-case.js";
import {
  type InputRulePointers,
  inputRulePointerVariables,
  ROOT_INPUT_RULE_POINTERS,
} from "./input-rules-case.js";
import { type CaseResult, type SuiteReport, suiteReportOf } from "./suite-report.js";
import { TemplateError, TemplateScope, WHOLE_PLACEHOLDER } from "./template.js";

/**
 * The credentials the sample app's hooks honour, read by the cases as `{{userToken}}`, `{{throttledUserToken}}`,
 * `{{serviceJwt}}`, `{{foreignServiceJwt}}`, `{{deviceToken}}`, `{{stripeSecret}}`, `{{throttleRetryAfterMs}}` and the
 * derived `{{throttleRetryAfterSeconds}}`.
 */
export interface SuiteCredentials {
  readonly userToken: string;
  readonly throttledUserToken: string;
  readonly serviceJwt: string;
  readonly stripeSecret: string;
  readonly throttleRetryAfterMs: number;
  /** The bearer token of a service the service api's `callerService` requirement does not allow. */
  readonly foreignServiceJwt: string;
  /** The `X-Device-Token` value of the paired device the device identity's hook accepts. */
  readonly deviceToken: string;
}

export interface SuiteRunOptions {
  readonly baseUrl: string;
  /** The server target the sample app was built with, as the report names it. */
  readonly target: string;
  readonly profile: SuiteProfile;
  readonly credentials: SuiteCredentials;
  readonly cases: readonly SuiteCase[];
  /** A `pack:<name>` profile's reader: the `default` cases read their responses through it. */
  readonly reader?: FormatReader;
  /** Cases the sample app does not run, by case id, with the reason the report names. */
  readonly refusals?: Readonly<Record<string, string>>;
  /** Where the `input-rules` case's cross-member and unnamed rules point; the body root when absent. */
  readonly inputRulePointers?: InputRulePointers;
  readonly requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MILLISECONDS_PER_SECOND = 1000;
const JSON_MEDIA = "application/json";
const HOST_HEADER = "host";
const CONTENT_ENCODING_HEADER = "content-encoding";
// The origin a captured link is resolved under; only the resolved path and query are sent to the target.
const RESOLUTION_ORIGIN = "http://target.invalid";

interface RunContext {
  readonly target: string;
  readonly baseUrl: string;
  readonly variables: Readonly<Record<string, JsonValue>>;
  readonly requestTimeoutMs: number;
  readonly reader: FormatReader | undefined;
}

export async function runSuite(options: SuiteRunOptions): Promise<SuiteReport> {
  const refusals = options.refusals ?? {};

  if (options.profile === BOOT_PROFILE) {
    throw new Error(
      "http-suite: the boot profile sends no request; run its cases with runBootSuite",
    );
  }

  refuseForeignCases(options.cases, options.profile);
  refuseMisplacedReader(options.reader, options.profile);
  refuseUnknownRefusals(options.cases, refusals);

  const context: RunContext = {
    target: options.target,
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    variables: {
      ...variablesOf(options.credentials),
      ...inputRulePointerVariables(options.inputRulePointers ?? ROOT_INPUT_RULE_POINTERS),
    },
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    reader: options.reader,
  };
  const results: CaseResult[] = [];

  for (const suiteCase of options.cases) {
    const reason = refusals[suiteCase.id] ?? outsideTargetsReason(suiteCase, options.target);

    results.push(
      reason === undefined
        ? await runCase(suiteCase, context)
        : refusedResult(suiteCase, reason, options.target),
    );
  }

  return suiteReportOf({ target: options.target, profile: options.profile }, results);
}

/** Throws when a case does not run in `profile`. */
export function refuseForeignCases(cases: readonly SuiteCase[], profile: SuiteProfile): void {
  const foreign = cases.filter((suiteCase) => !runsInProfile(suiteCase, profile));

  if (foreign.length > 0) {
    throw new Error(
      `http-suite: the cases ${foreign.map((suiteCase) => suiteCase.id).join(", ")} do not run in the '${profile}' profile`,
    );
  }
}

/** Throws when a format reader is given to a profile that is no pack's, or a pack profile has none. */
function refuseMisplacedReader(reader: FormatReader | undefined, profile: SuiteProfile): void {
  const isPackProfile = profile.startsWith("pack:");

  if (isPackProfile && reader === undefined) {
    throw new Error(`http-suite: the '${profile}' profile reads responses through a format reader`);
  }

  if (!isPackProfile && reader !== undefined) {
    throw new Error(
      `http-suite: the '${profile}' profile reads bare responses and takes no format reader`,
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

export function refusedResult(suiteCase: SuiteCase, reason: string, target: string): CaseResult {
  return { ...caseHeader(suiteCase, target), outcome: "refused", failures: [], reason };
}

/** The case's id, title and the checklist ids it proves in a report of [target]. */
export function caseHeader(
  suiteCase: SuiteCase,
  target: string,
): Pick<CaseResult, "id" | "title" | "checks"> {
  return {
    id: suiteCase.id,
    title: suiteCase.title,
    checks: checkIdsForTarget(suiteCase.checks, target),
  };
}

async function runCase(suiteCase: SuiteCase, context: RunContext): Promise<CaseResult> {
  const scope = new TemplateScope(context.variables);
  const captureTargets = new Map<string, string>();
  const failures: string[] = [];
  const reader = suiteCase.profiles.includes("default") ? context.reader : undefined;
  // A background request runs beside the later steps; its failures are reported once every step has run.
  const backgroundRuns: Promise<string[]>[] = [];

  try {
    await loadScript(context.baseUrl, suiteCase.script ?? {}, timeoutSignal(context));

    for (const [index, step] of suiteCase.steps.entries()) {
      if (isScriptStep(step)) {
        await loadScript(context.baseUrl, step.script, timeoutSignal(context));
        continue;
      }

      const label = `step ${index} (${step.title ?? `${step.request.method} ${step.request.path}`})`;
      const labelled = async (): Promise<string[]> =>
        (await runStepAfterItsHookCall(step, scope, captureTargets, context, reader)).map(
          (failure) => `${label}: ${failure}`,
        );

      if (step.background === true) backgroundRuns.push(labelled().catch(failureOf(label)));
      else failures.push(...(await labelled()));
    }

    // Taken out of the list once awaited, so a later throw does not release or report them twice.
    for (const backgroundFailures of await Promise.all(backgroundRuns.splice(0))) {
      failures.push(...backgroundFailures);
    }

    if (suiteCase.hookCalls !== undefined) {
      failures.push(...(await checkHookCalls(suiteCase, context)));
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    failures.push(...(await releaseBackgroundRuns(backgroundRuns, context)));
  }

  return {
    ...caseHeader(suiteCase, context.target),
    outcome: failures.length === 0 ? "passed" : "failed",
    failures,
  };
}

// A step threw before the case released what it holds: an empty script releases a held request, so none outlives its
// case and answers from the next case's script.
async function releaseBackgroundRuns(
  backgroundRuns: readonly Promise<string[]>[],
  context: RunContext,
): Promise<string[]> {
  if (backgroundRuns.length === 0) return [];

  const failures: string[] = [];

  try {
    await loadScript(context.baseUrl, {}, timeoutSignal(context));
  } catch (error) {
    failures.push(
      `releasing the background requests: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const backgroundFailures of await Promise.all(backgroundRuns))
    failures.push(...backgroundFailures);

  return failures;
}

function failureOf(label: string): (error: unknown) => string[] {
  return (error) => [`${label}: ${error instanceof Error ? error.message : String(error)}`];
}

const HOOK_CALL_POLL_MS = 25;

async function runStepAfterItsHookCall(
  step: SuiteStep,
  scope: TemplateScope,
  captureTargets: Map<string, string>,
  context: RunContext,
  reader: FormatReader | undefined,
): Promise<string[]> {
  const awaited = step.waitForHookCall;

  if (awaited !== undefined && !(await hookCallRecorded(awaited, context))) {
    return [
      `the sample app recorded no hook call ${JSON.stringify(awaited)} within ${context.requestTimeoutMs} ms, so the request was not sent`,
    ];
  }

  return runStep(step, scope, captureTargets, context, reader);
}

async function hookCallRecorded(awaited: RecordedHookCall, context: RunContext): Promise<boolean> {
  const deadline = Date.now() + context.requestTimeoutMs;

  while (Date.now() < deadline) {
    const calls = await readHookCalls(context.baseUrl, timeoutSignal(context));

    if (calls.some((call) => call.hook === awaited.hook && call.operation === awaited.operation)) {
      return true;
    }

    await setTimeout(HOOK_CALL_POLL_MS);
  }

  return false;
}

async function checkHookCalls(suiteCase: SuiteCase, context: RunContext): Promise<string[]> {
  const recorded = await readHookCalls(context.baseUrl, timeoutSignal(context));
  const expected = JSON.stringify(suiteCase.hookCalls);
  const actual = JSON.stringify(recorded);

  return expected === actual ? [] : [`hook calls ${actual}, expected ${expected}`];
}

// `captureTargets` holds, per capture name, the path and query of the request whose response it came from.
async function runStep(
  step: SuiteStep,
  scope: TemplateScope,
  captureTargets: Map<string, string>,
  context: RunContext,
  reader: FormatReader | undefined,
): Promise<string[]> {
  const path = filledPath(step.request.path, scope, captureTargets);
  const target = `${path}${queryOf(step.request.query, path, scope)}`;
  const linesBefore = await logLineCountBefore(step, context);
  const { response, readFailures } = readThroughFormat(
    await send(step, target, scope, context),
    { method: step.request.method, path },
    reader,
  );
  const failures: string[] = [
    ...readFailures,
    ...(await logLinesFailures(step, scope, linesBefore, context)),
  ];

  for (const [name, source] of Object.entries(step.capture ?? {})) {
    const value = capturedValue(source, response);

    if (value === undefined)
      failures.push(`capture '${name}': the response holds no ${JSON.stringify(source)}`);
    else {
      scope.capture(name, value);
      captureTargets.set(name, target);
    }
  }

  // The status often explains a failed capture, so the expectation is checked and reported too.
  try {
    return [...failures, ...checkResponse(filledExpectation(step, scope), response)];
  } catch (error) {
    if (failures.length === 0 || !(error instanceof TemplateError)) throw error;

    return [...failures, error.message];
  }
}

// The lines logged since the last script load, counted before a step that checks its own log lines.
async function logLineCountBefore(step: SuiteStep, context: RunContext): Promise<number> {
  if (step.expect.logLines === undefined) return 0;

  return (await readLogLines(context.baseUrl, timeoutSignal(context))).length;
}

async function logLinesFailures(
  step: SuiteStep,
  scope: TemplateScope,
  linesBefore: number,
  context: RunContext,
): Promise<string[]> {
  const expectation = step.expect.logLines;

  if (expectation === undefined) return [];

  const stepLines = (await readLogLines(context.baseUrl, timeoutSignal(context))).slice(
    linesBefore,
  );
  const filled = {
    ...(expectation.contains === undefined
      ? {}
      : { contains: expectation.contains.map((text) => scope.fillText(text)) }),
    ...(expectation.excludes === undefined
      ? {}
      : { excludes: expectation.excludes.map((text) => scope.fillText(text)) }),
  };

  return checkLogLines(filled, stepLines);
}

// A case written in bare terms sees a pack's response as the bare format would have written it.
function readThroughFormat(
  response: ReceivedResponse,
  request: SentRequest,
  reader: FormatReader | undefined,
): { response: ReceivedResponse; readFailures: readonly string[] } {
  if (reader === undefined || response.json === undefined) return { response, readFailures: [] };

  const read = reader.read(response.status, response.json, request);

  return { response: { ...response, json: read.json }, readFailures: read.failures };
}

function capturedValue(source: CaptureSource, response: ReceivedResponse): JsonValue | undefined {
  if ("bodyText" in source) return response.text;

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

// A path filled from a response (`{{nextPage}}`) must stay on the target: `@host/x` or `//host/x` would send the
// request and its credentials elsewhere.
// A path that is one captured link alone is resolved against the URL of the request it came from (RFC 3986), so a
// query-only or relative-path link stays on the target; a link to another origin is refused.
function filledPath(
  path: string,
  scope: TemplateScope,
  captureTargets: ReadonlyMap<string, string>,
): string {
  const filled = scope.fillText(path);

  if (filled.startsWith("/") && !filled.startsWith("//")) return filled;

  const captureTarget = captureTargets.get(WHOLE_PLACEHOLDER.exec(path)?.[1] ?? "");
  const resolved =
    captureTarget === undefined
      ? undefined
      : new URL(filled, `${RESOLUTION_ORIGIN}${captureTarget}`);

  if (resolved?.origin !== RESOLUTION_ORIGIN) {
    throw new Error(
      `the path '${path}' fills to '${filled}', which does not start with one '/' and is not a link on the target; the suite only sends a path of the target`,
    );
  }

  return `${resolved.pathname}${resolved.search}`;
}

async function send(
  step: SuiteStep,
  target: string,
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

  const url = `${context.baseUrl}${target}`;
  const sentBody = compressedBody(request, body, headers);

  if (headers.has(HOST_HEADER))
    return sendWithForgedHost(url, request.method, headers, sentBody, context);

  const answer = await fetch(url, {
    method: request.method,
    headers,
    ...(sentBody === undefined ? {} : { body: sentBody }),
    redirect: "manual",
    signal: timeoutSignal(context),
  });
  const text = await answer.text();

  return { status: answer.status, headers: answer.headers, text, json: parseJson(text) };
}

// `fetch` drops a `Host` header it is given and sends the URL's own, so a case that forges one would pass without
// sending it: such a step goes through `node:http`, which sends the header as written.
async function sendWithForgedHost(
  url: string,
  method: string,
  headers: Headers,
  body: string | Uint8Array | undefined,
  context: RunContext,
): Promise<ReceivedResponse> {
  const send = new URL(url).protocol === "https:" ? httpsRequest : httpRequest;
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = send(url, {
      method,
      headers: Object.fromEntries(headers),
      signal: timeoutSignal(context),
    });

    outgoing.on("response", resolve);
    outgoing.on("error", reject);
    outgoing.end(body);
  });
  const chunks: Buffer[] = [];

  for await (const chunk of response) chunks.push(Buffer.from(chunk));

  const text = Buffer.concat(chunks).toString("utf8");

  if (response.statusCode === undefined) throw new Error(`http-suite: ${url} answered no status`);

  return {
    status: response.statusCode,
    headers: receivedHeaders(response),
    text,
    json: parseJson(text),
  };
}

function receivedHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;

    for (const each of Array.isArray(value) ? value : [value]) headers.append(name, each);
  }

  return headers;
}

function bodyOf(request: SuiteStep["request"], scope: TemplateScope): string | undefined {
  if (request.bodyText !== undefined) return scope.fillText(request.bodyText);

  return request.body === undefined ? undefined : JSON.stringify(scope.fill(request.body));
}

// The signature, when the step has one, covers the body before it is compressed, as a target verifies the decoded body.
function compressedBody(
  request: SuiteStep["request"],
  body: string | undefined,
  headers: Headers,
): string | Uint8Array | undefined {
  if (request.compress === undefined || body === undefined) return body;

  if (!headers.has(CONTENT_ENCODING_HEADER)) headers.set(CONTENT_ENCODING_HEADER, request.compress);

  const compressed = gzipSync(body);

  return compressed.subarray(0, compressed.byteLength - (request.cutCompressedBytes ?? 0));
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
