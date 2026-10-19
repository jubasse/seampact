// The test-only routes a sample app serves beside the contract, so a case loads the doubles' script and reads what
// the hooks recorded and what the app logged (ADR 0015 "Control routes"). Every sample app, in any language,
// serves them with these paths and JSON bodies.
import type { SampleAppScript } from "./sample-app-script.js";
import type { RecordedHookCall } from "./suite-case.js";

/** The path prefix of the control routes; the sample app allow-lists it as framework routes outside the contract. */
export const CONTROL_ROUTE_PREFIX = "/__seampact";

/**
 * `PUT` with the case's `script` as its JSON body (`SampleAppScript`): the doubles answer from it, and the recorded
 * hook calls and captured log lines start empty. Answers 204, or 400 for a body that is not a script.
 */
export const SCRIPT_ROUTE = `${CONTROL_ROUTE_PREFIX}/script`;

/**
 * `GET`: answers 200 with `{ "calls": RecordedHookCall[] }`, in call order since the last script load: each
 * authenticate and decide call, named as `authenticateHookName` and `decideHookName` name them, with the
 * operation's `operationKey`.
 */
export const HOOK_CALLS_ROUTE = `${CONTROL_ROUTE_PREFIX}/hook-calls`;

/** `GET`: answers 200 with `{ "lines": string[] }`, every log line the app wrote since the last script load. */
export const LOG_LINES_ROUTE = `${CONTROL_ROUTE_PREFIX}/log-lines`;

const NO_CONTENT = 204;
const OK = 200;

export async function loadScript(
  baseUrl: string,
  script: SampleAppScript,
  signal: AbortSignal,
): Promise<void> {
  const answer = await fetch(`${baseUrl}${SCRIPT_ROUTE}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(script),
    signal,
  });

  if (answer.status !== NO_CONTENT) {
    throw new Error(
      `PUT ${SCRIPT_ROUTE} answered ${answer.status}, expected ${NO_CONTENT}: the sample app serves no script control route`,
    );
  }
}

export async function readHookCalls(
  baseUrl: string,
  signal: AbortSignal,
): Promise<RecordedHookCall[]> {
  const body = await readControlRoute(baseUrl, HOOK_CALLS_ROUTE, signal);
  const calls = isRecord(body) ? body.calls : undefined;

  if (!Array.isArray(calls) || !calls.every(isRecordedHookCall)) {
    throw new Error(`GET ${HOOK_CALLS_ROUTE} answered no '{ "calls": [{ "hook", "operation" }] }'`);
  }

  return calls.map((call) => ({ hook: call.hook, operation: call.operation }));
}

export async function readLogLines(baseUrl: string, signal: AbortSignal): Promise<string[]> {
  const body = await readControlRoute(baseUrl, LOG_LINES_ROUTE, signal);
  const lines = isRecord(body) ? body.lines : undefined;

  if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) {
    throw new Error(`GET ${LOG_LINES_ROUTE} answered no '{ "lines": string[] }'`);
  }

  return [...lines];
}

async function readControlRoute(
  baseUrl: string,
  route: string,
  signal: AbortSignal,
): Promise<unknown> {
  const answer = await fetch(`${baseUrl}${route}`, { signal });

  if (answer.status !== OK) {
    throw new Error(`GET ${route} answered ${answer.status}, expected ${OK}`);
  }

  return answer.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordedHookCall(value: unknown): value is RecordedHookCall {
  return isRecord(value) && typeof value.hook === "string" && typeof value.operation === "string";
}
