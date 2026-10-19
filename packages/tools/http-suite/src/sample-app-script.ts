// The sample app script: what a case loads through the script control route so the app's hook doubles and
// handlers answer the case's way, and the names the doubles record their calls under. The format is
// language-neutral JSON; a sample app in any language reads it with the same meaning.
import {
  arrayAt,
  type JsonReader,
  jsonAt,
  objectAt,
  patternAt,
  statusAt,
  stringAt,
} from "./json-reader.js";
import type { JsonValue } from "./suite-case.js";

/** A denial a double answers with: one of the hook's declared error codes and its params. */
export interface ScriptedDenial {
  readonly code: string;
  readonly params?: JsonValue;
}

/** Why the boundary asks the decide hook, as `RequirementRequest.purpose.kind` names it. */
export type DecidePurpose = "route" | "field" | "sortKey";

/**
 * The decide double denies every call for the right or rule `name`, or only the calls of one `purpose` when it is
 * given; any other call answers as the sample app's doubles do without a script.
 */
export interface ScriptedDecision {
  readonly name: string;
  readonly purpose?: DecidePurpose;
  readonly deny: ScriptedDenial;
}

/** The resolve-scope double of one scope kind denies every call with `deny`. */
export interface ScriptedScope {
  readonly deny: ScriptedDenial;
}

/**
 * What a handler answers in place of its own result: a handler result as the server target reads it (`status` and
 * `body`, or `status`, `code` and `params` for a declared error), sent as is even when the operation does not
 * declare it, or an exception with the message `throws`.
 */
export type ScriptedAnswer =
  | {
      readonly status: number;
      readonly body?: JsonValue;
      readonly code?: string;
      readonly params?: JsonValue;
    }
  | { readonly throws: string };

/**
 * The script of one case. `answers` is keyed by `<api>.<operationId>`, the operation as the hooks receive it in
 * `OperationRef`. Every member is optional; an empty script only resets the recorded calls and log lines.
 */
export interface SampleAppScript {
  readonly decisions?: readonly ScriptedDecision[];
  readonly scopes?: Readonly<Record<string, ScriptedScope>>;
  readonly answers?: Readonly<Record<string, ScriptedAnswer>>;
}

/** The hook name an authenticate double records: `authenticate:<identity>`. */
export function authenticateHookName(identity: string): string {
  return `authenticate:${identity}`;
}

/** The hook name a decide double records: `decide:<right or rule>`. */
export function decideHookName(requirement: string): string {
  return `decide:${requirement}`;
}

/** The operation a double records and an answer is keyed by: `<api>.<operationId>`. */
export function operationKey(api: string, operationId: string): string {
  return `${api}.${operationId}`;
}

/** A script the sample app was sent that does not follow the format, named by the JSON pointer of the fault. */
export class SampleAppScriptError extends Error {
  constructor(pointer: string, problem: string) {
    super(`http-suite: the sample app script at '${pointer}': ${problem}`);
    this.name = "SampleAppScriptError";
  }
}

const SCRIPT_MEMBERS = ["decisions", "scopes", "answers"];
const DECISION_MEMBERS = ["name", "purpose", "deny"];
const SCOPE_MEMBERS = ["deny"];
const DENIAL_MEMBERS = ["code", "params"];
const RESULT_ANSWER_MEMBERS = ["status", "body", "code", "params"];
const THROWING_ANSWER_MEMBERS = ["throws"];
const DECIDE_PURPOSES: readonly string[] = ["route", "field", "sortKey"];
const OPERATION_KEY = /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/;

/** Reads the body of a script control route request; the sample app answers 400 with the error's message. */
export function parseSampleAppScript(value: unknown): SampleAppScript {
  return readSampleAppScript(
    {
      fail: (pointer, problem) => {
        throw new SampleAppScriptError(pointer, problem);
      },
    },
    value,
    "",
  );
}

/** Reads a script at `pointer` of a larger document, so a case file names its own pointer. */
export function readSampleAppScript(
  reader: JsonReader,
  value: unknown,
  pointer: string,
): SampleAppScript {
  const object = objectAt(reader, value, pointer, SCRIPT_MEMBERS);

  return {
    ...(object.decisions === undefined
      ? {}
      : {
          decisions: arrayAt(reader, object.decisions, `${pointer}/decisions`).map(
            (decision, index) => readDecision(reader, decision, `${pointer}/decisions/${index}`),
          ),
        }),
    ...(object.scopes === undefined
      ? {}
      : { scopes: readScopes(reader, object.scopes, `${pointer}/scopes`) }),
    ...(object.answers === undefined
      ? {}
      : { answers: readAnswers(reader, object.answers, `${pointer}/answers`) }),
  };
}

function readDecision(reader: JsonReader, value: unknown, pointer: string): ScriptedDecision {
  const object = objectAt(reader, value, pointer, DECISION_MEMBERS);

  return {
    name: stringAt(reader, object.name, `${pointer}/name`),
    ...(object.purpose === undefined
      ? {}
      : { purpose: readPurpose(reader, object.purpose, `${pointer}/purpose`) }),
    deny: readDenial(reader, object.deny, `${pointer}/deny`),
  };
}

function readPurpose(reader: JsonReader, value: unknown, pointer: string): DecidePurpose {
  const purpose = stringAt(reader, value, pointer);

  if (purpose === "route" || purpose === "field" || purpose === "sortKey") return purpose;

  return reader.fail(pointer, `the purpose is one of ${DECIDE_PURPOSES.join(", ")}`);
}

function readScopes(
  reader: JsonReader,
  value: unknown,
  pointer: string,
): Record<string, ScriptedScope> {
  return Object.fromEntries(
    Object.entries(objectAt(reader, value, pointer, undefined)).map(([scope, entry]) => {
      const object = objectAt(reader, entry, `${pointer}/${scope}`, SCOPE_MEMBERS);

      return [scope, { deny: readDenial(reader, object.deny, `${pointer}/${scope}/deny`) }];
    }),
  );
}

function readDenial(reader: JsonReader, value: unknown, pointer: string): ScriptedDenial {
  const object = objectAt(reader, value, pointer, DENIAL_MEMBERS);

  return {
    code: stringAt(reader, object.code, `${pointer}/code`),
    ...(object.params === undefined
      ? {}
      : { params: jsonAt(reader, object.params, `${pointer}/params`) }),
  };
}

function readAnswers(
  reader: JsonReader,
  value: unknown,
  pointer: string,
): Record<string, ScriptedAnswer> {
  return Object.fromEntries(
    Object.entries(objectAt(reader, value, pointer, undefined)).map(([key, answer]) => {
      const answerPointer = `${pointer}/${key}`;

      patternAt(reader, key, answerPointer, OPERATION_KEY);

      return [key, readAnswer(reader, answer, answerPointer)];
    }),
  );
}

function readAnswer(reader: JsonReader, value: unknown, pointer: string): ScriptedAnswer {
  const isThrowing = typeof value === "object" && value !== null && "throws" in value;
  const object = objectAt(
    reader,
    value,
    pointer,
    isThrowing ? THROWING_ANSWER_MEMBERS : RESULT_ANSWER_MEMBERS,
  );

  if (isThrowing) return { throws: stringAt(reader, object.throws, `${pointer}/throws`) };

  return {
    status: statusAt(reader, object.status, `${pointer}/status`),
    ...(object.body === undefined ? {} : { body: jsonAt(reader, object.body, `${pointer}/body`) }),
    ...(object.code === undefined
      ? {}
      : { code: stringAt(reader, object.code, `${pointer}/code`) }),
    ...(object.params === undefined
      ? {}
      : { params: jsonAt(reader, object.params, `${pointer}/params`) }),
  };
}
