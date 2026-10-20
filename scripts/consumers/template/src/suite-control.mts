// The sample app's side of the http suite's control routes, framework-neutral: the script a case loads, the hook
// calls the doubles record and the log lines the app writes. Each overlay serves the three routes as framework
// routes outside the contract, and the hooks and handlers read the script from here.
import {
  type DecidePurpose,
  operationKey,
  parseSampleAppScript,
  type RecordedHookCall,
  type SampleAppScript,
  SampleAppScriptError,
  type ScriptedAnswer,
  type ScriptedDenial,
} from "@seampact/http-suite";

/** What a control route answers: its status and, unless it is 204, a JSON body. */
export interface ControlReply {
  readonly status: number;
  readonly body?: unknown;
}

const NO_CONTENT = 204;
const OK = 200;
const BAD_REQUEST = 400;

let loadedScript: SampleAppScript = {};
// Off until the suite loads a script, so a run without the suite (the bench) keeps no growing call log.
let recordingHookCalls = false;
const hookCalls: RecordedHookCall[] = [];
const logLines: string[] = [];

/** `PUT /__seampact/script`: loads the script, empties the recorded calls and log lines, and records hook calls from then on. */
export function loadScriptReply(body: unknown): ControlReply {
  try {
    loadedScript = parseSampleAppScript(body);
  } catch (error) {
    if (!(error instanceof SampleAppScriptError)) throw error;

    return { status: BAD_REQUEST, body: { message: error.message } };
  }

  recordingHookCalls = true;
  hookCalls.length = 0;
  logLines.length = 0;

  return { status: NO_CONTENT };
}

/** `GET /__seampact/hook-calls`. */
export function hookCallsReply(): ControlReply {
  return { status: OK, body: { calls: hookCalls.map((call) => ({ ...call })) } };
}

/** `GET /__seampact/log-lines`. */
export function logLinesReply(): ControlReply {
  return { status: OK, body: { lines: [...logLines] } };
}

export function recordHookCall(hook: string, operation: { api: string; id: string }): void {
  if (!recordingHookCalls) return;

  hookCalls.push({ hook, operation: operationKey(operation.api, operation.id) });
}

export function writeLogLine(line: string): void {
  logLines.push(line);
}

/** The denial the script gives a decide call for `name` and `purpose`, if any. */
export function scriptedDecision(name: string, purpose: DecidePurpose): ScriptedDenial | undefined {
  return loadedScript.decisions?.find(
    (decision) =>
      decision.name === name && (decision.purpose === undefined || decision.purpose === purpose),
  )?.deny;
}

/** The denial the script gives every resolve-scope call of `scope`, if any. */
export function scriptedScopeDenial(scope: string): ScriptedDenial | undefined {
  return loadedScript.scopes?.[scope]?.deny;
}

/** The answer the script gives an operation's handler in place of its own, if any. */
export function scriptedAnswer(api: string, operationId: string): ScriptedAnswer | undefined {
  return loadedScript.answers?.[operationKey(api, operationId)];
}
