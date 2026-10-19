// The case script format: one JSON file per case, read and checked here before any request is sent.

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [member: string]: JsonValue };

/** A profile selects how the suite reads responses and which cases apply (ADR 0015 "Suite profiles"). */
export type SuiteProfile =
  | "default"
  | "hand-written"
  | "boot"
  | `pack:${string}`
  | `adapter:${string}`;

/**
 * One response header check: `equals` the whole value, `contains` each substring, `excludes` a substring (an
 * absent header passes), or `absent` the header.
 */
export interface HeaderExpectation {
  readonly equals?: string;
  readonly contains?: readonly string[];
  readonly excludes?: string;
  readonly absent?: true;
}

/** A request signature the runner computes over the exact body bytes it sends. */
export interface RequestSignature {
  readonly scheme: string;
  readonly header: string;
  readonly secret: string;
}

/**
 * The request of a step. `path` is sent as written (no normalisation, so a doubled slash or a percent-encoded
 * segment reaches the server); `query` is appended encoded; a `body` is sent as JSON with
 * `content-type: application/json` unless `headers` names another content type.
 */
export interface StepRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, JsonValue>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: JsonValue;
  readonly sign?: RequestSignature;
}

/**
 * What a response must show. `body` is a subset match: objects match member by member, arrays element by element
 * with the same length, other values by equality. `bodyText` is the exact text. `absent` lists JSON pointers the
 * body must hold nothing at.
 */
export interface StepExpectation {
  readonly status: number;
  readonly headers?: Readonly<Record<string, HeaderExpectation>>;
  readonly body?: JsonValue;
  readonly bodyText?: string;
  readonly absent?: readonly string[];
}

/**
 * Where a captured value comes from: the JSON body at a JSON pointer (`""` is the whole body), or the first group
 * of a regular expression over a response header.
 */
export type CaptureSource =
  | { readonly body: string }
  | { readonly header: string; readonly pattern: string };

/**
 * One request and its expectation. `capture` names values of the response, read before the expectation is
 * checked, for `{{name}}` in this step and the later ones.
 */
export interface SuiteStep {
  readonly title?: string;
  readonly request: StepRequest;
  readonly capture?: Readonly<Record<string, CaptureSource>>;
  readonly expect: StepExpectation;
}

/**
 * A case: its id is its file name, `checks` the checklist ids it proves, `profiles` the profiles that run it.
 * `script` is loaded through the control routes before the first step; `hookCalls` is then the exact list of hook
 * calls the sample app must have recorded once every step has run.
 */
export interface SuiteCase {
  readonly id: string;
  readonly title: string;
  readonly checks: readonly string[];
  readonly profiles: readonly SuiteProfile[];
  readonly script?: { readonly [member: string]: JsonValue };
  readonly steps: readonly SuiteStep[];
  readonly hookCalls?: readonly RecordedHookCall[];
}

/** One hook call the sample app records: the hook's name and the operation it ran for. */
export interface RecordedHookCall {
  readonly hook: string;
  readonly operation: string;
}

export const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CHECK_ID = /^CHK-\d{3}$/;
const PROFILE = /^(?:default|hand-written|boot|pack:[a-z0-9-]+|adapter:[a-z0-9-]+)$/;
const HTTP_METHOD = /^[A-Z]+$/;
const LOWERCASE_HEADER = /^[a-z0-9-]+$/;
const MIN_STATUS = 100;
const MAX_STATUS = 599;

/** The variable names the runner fills from its credentials; a capture cannot take one. */
export const CREDENTIAL_VARIABLES = [
  "userToken",
  "throttledUserToken",
  "serviceJwt",
  "stripeSecret",
  "throttleRetryAfterMs",
  "throttleRetryAfterSeconds",
];

const CASE_MEMBERS = ["id", "title", "checks", "profiles", "script", "steps", "hookCalls"];
const STEP_MEMBERS = ["title", "request", "capture", "expect"];
const REQUEST_MEMBERS = ["method", "path", "query", "headers", "body", "sign"];
const SIGN_MEMBERS = ["scheme", "header", "secret"];
const EXPECT_MEMBERS = ["status", "headers", "body", "bodyText", "absent"];
const BODY_CAPTURE_MEMBERS = ["body"];
const HEADER_CAPTURE_MEMBERS = ["header", "pattern"];
const HEADER_EXPECTATION_MEMBERS = ["equals", "contains", "excludes", "absent"];
const HOOK_CALL_MEMBERS = ["hook", "operation"];

/** A case file that does not follow the format, named by its source and the JSON pointer of the fault. */
export class SuiteCaseError extends Error {
  constructor(source: string, pointer: string, problem: string) {
    super(`http-suite: ${source} at '${pointer}': ${problem}`);
    this.name = "SuiteCaseError";
  }
}

interface Reader {
  readonly source: string;
  fail(pointer: string, problem: string): never;
}

/** Reads one parsed case file; `source` names it in errors. Every member is checked, an unknown one refused. */
export function parseSuiteCase(value: unknown, source: string): SuiteCase {
  const reader: Reader = {
    source,
    fail: (pointer, problem) => {
      throw new SuiteCaseError(source, pointer, problem);
    },
  };
  const object = objectAt(reader, value, "", CASE_MEMBERS);
  const id = patternAt(reader, object.id, "/id", CASE_ID);
  const steps = arrayAt(reader, object.steps, "/steps").map((step, index) =>
    readStep(reader, step, `/steps/${index}`),
  );

  if (steps.length === 0) reader.fail("/steps", "a case has at least one step");

  return {
    id,
    title: stringAt(reader, object.title, "/title"),
    checks: arrayAt(reader, object.checks, "/checks").map((check, index) =>
      patternAt(reader, check, `/checks/${index}`, CHECK_ID),
    ),
    profiles: readProfiles(reader, object.profiles),
    ...(object.script === undefined
      ? {}
      : { script: jsonObjectAt(reader, object.script, "/script") }),
    steps,
    ...(object.hookCalls === undefined
      ? {}
      : { hookCalls: readHookCalls(reader, object.hookCalls) }),
  };
}

function readProfiles(reader: Reader, value: unknown): SuiteProfile[] {
  const profiles = arrayAt(reader, value, "/profiles").map((profile, index) =>
    patternAt(reader, profile, `/profiles/${index}`, PROFILE),
  );

  if (profiles.length === 0) reader.fail("/profiles", "a case runs in at least one profile");

  return profiles.filter(isSuiteProfile);
}

function isSuiteProfile(profile: string): profile is SuiteProfile {
  return PROFILE.test(profile);
}

function readHookCalls(reader: Reader, value: unknown): RecordedHookCall[] {
  return arrayAt(reader, value, "/hookCalls").map((call, index) => {
    const pointer = `/hookCalls/${index}`;
    const object = objectAt(reader, call, pointer, HOOK_CALL_MEMBERS);

    return {
      hook: stringAt(reader, object.hook, `${pointer}/hook`),
      operation: stringAt(reader, object.operation, `${pointer}/operation`),
    };
  });
}

function readStep(reader: Reader, value: unknown, pointer: string): SuiteStep {
  const object = objectAt(reader, value, pointer, STEP_MEMBERS);

  return {
    ...(object.title === undefined
      ? {}
      : { title: stringAt(reader, object.title, `${pointer}/title`) }),
    request: readRequest(reader, object.request, `${pointer}/request`),
    ...(object.capture === undefined
      ? {}
      : { capture: readCaptures(reader, object.capture, `${pointer}/capture`) }),
    expect: readExpectation(reader, object.expect, `${pointer}/expect`),
  };
}

function readCaptures(
  reader: Reader,
  value: unknown,
  pointer: string,
): Record<string, CaptureSource> {
  const object = objectAt(reader, value, pointer, undefined);

  return Object.fromEntries(
    Object.entries(object).map(([name, source]) => {
      if (CREDENTIAL_VARIABLES.includes(name)) {
        reader.fail(`${pointer}/${name}`, "a capture cannot take the name of a credential");
      }

      return [name, readCaptureSource(reader, source, `${pointer}/${name}`)];
    }),
  );
}

function readCaptureSource(reader: Reader, value: unknown, pointer: string): CaptureSource {
  const isBodyCapture = typeof value === "object" && value !== null && "body" in value;
  const object = objectAt(
    reader,
    value,
    pointer,
    isBodyCapture ? BODY_CAPTURE_MEMBERS : HEADER_CAPTURE_MEMBERS,
  );

  if (isBodyCapture) return { body: stringAt(reader, object.body, `${pointer}/body`) };

  const pattern = stringAt(reader, object.pattern, `${pointer}/pattern`);

  if (capturingGroupCount(reader, pattern, `${pointer}/pattern`) === 0) {
    reader.fail(
      `${pointer}/pattern`,
      "the pattern holds a capturing group, whose text is captured",
    );
  }

  return {
    header: patternAt(reader, object.header, `${pointer}/header`, LOWERCASE_HEADER),
    pattern,
  };
}

// An empty alternative makes any pattern match the empty string, so the match lists every group.
function capturingGroupCount(reader: Reader, pattern: string, pointer: string): number {
  try {
    return (new RegExp(`${pattern}|`).exec("")?.length ?? 1) - 1;
  } catch (error) {
    return reader.fail(
      pointer,
      `not a regular expression: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readRequest(reader: Reader, value: unknown, pointer: string): StepRequest {
  const object = objectAt(reader, value, pointer, REQUEST_MEMBERS);
  const path = stringAt(reader, object.path, `${pointer}/path`);

  if (!path.startsWith("/")) reader.fail(`${pointer}/path`, "a path starts with '/'");

  return {
    method: patternAt(reader, object.method, `${pointer}/method`, HTTP_METHOD),
    path,
    ...(object.query === undefined
      ? {}
      : { query: jsonObjectAt(reader, object.query, `${pointer}/query`) }),
    ...(object.headers === undefined
      ? {}
      : { headers: readHeaders(reader, object.headers, `${pointer}/headers`) }),
    ...(object.body === undefined ? {} : { body: jsonAt(reader, object.body, `${pointer}/body`) }),
    ...(object.sign === undefined
      ? {}
      : { sign: readSignature(reader, object.sign, `${pointer}/sign`) }),
  };
}

function readSignature(reader: Reader, value: unknown, pointer: string): RequestSignature {
  const object = objectAt(reader, value, pointer, SIGN_MEMBERS);

  return {
    scheme: stringAt(reader, object.scheme, `${pointer}/scheme`),
    header: patternAt(reader, object.header, `${pointer}/header`, LOWERCASE_HEADER),
    secret: stringAt(reader, object.secret, `${pointer}/secret`),
  };
}

function readHeaders(reader: Reader, value: unknown, pointer: string): Record<string, string> {
  const headers = stringMapAt(reader, value, pointer);

  for (const name of Object.keys(headers)) {
    if (!LOWERCASE_HEADER.test(name))
      reader.fail(`${pointer}/${name}`, "header names are lowercase");
  }

  return headers;
}

function readExpectation(reader: Reader, value: unknown, pointer: string): StepExpectation {
  const object = objectAt(reader, value, pointer, EXPECT_MEMBERS);
  const status = object.status;

  if (!Number.isInteger(status) || Number(status) < MIN_STATUS || Number(status) > MAX_STATUS) {
    reader.fail(
      `${pointer}/status`,
      `the status is an integer from ${MIN_STATUS} to ${MAX_STATUS}`,
    );
  }

  if (object.body !== undefined && object.bodyText !== undefined) {
    reader.fail(pointer, "an expectation checks either `body` or `bodyText`, not both");
  }

  return {
    status: Number(status),
    ...(object.headers === undefined
      ? {}
      : { headers: readHeaderExpectations(reader, object.headers, `${pointer}/headers`) }),
    ...(object.body === undefined ? {} : { body: jsonAt(reader, object.body, `${pointer}/body`) }),
    ...(object.bodyText === undefined
      ? {}
      : { bodyText: stringAt(reader, object.bodyText, `${pointer}/bodyText`) }),
    ...(object.absent === undefined
      ? {}
      : { absent: readAbsentPointers(reader, object.absent, `${pointer}/absent`) }),
  };
}

function readAbsentPointers(reader: Reader, value: unknown, pointer: string): string[] {
  const pointers = arrayAt(reader, value, pointer);

  if (pointers.length === 0) reader.fail(pointer, "`absent` lists at least one JSON pointer");

  return pointers.map((item, index) => {
    const absentPointer = stringAt(reader, item, `${pointer}/${index}`);

    if (!absentPointer.startsWith("/")) {
      reader.fail(`${pointer}/${index}`, "a JSON pointer to a member starts with `/`");
    }

    return absentPointer;
  });
}

function readHeaderExpectations(
  reader: Reader,
  value: unknown,
  pointer: string,
): Record<string, HeaderExpectation> {
  const object = objectAt(reader, value, pointer, undefined);

  return Object.fromEntries(
    Object.entries(object).map(([name, expectation]) => {
      if (!LOWERCASE_HEADER.test(name))
        reader.fail(`${pointer}/${name}`, "header names are lowercase");

      return [name, readHeaderExpectation(reader, expectation, `${pointer}/${name}`)];
    }),
  );
}

function readHeaderExpectation(reader: Reader, value: unknown, pointer: string): HeaderExpectation {
  const object = objectAt(reader, value, pointer, HEADER_EXPECTATION_MEMBERS);

  if (Object.keys(object).length !== 1) {
    reader.fail(
      pointer,
      "a header expectation holds one of `equals`, `contains`, `excludes`, `absent`",
    );
  }

  if (object.absent !== undefined && object.absent !== true) {
    reader.fail(`${pointer}/absent`, "`absent` is `true`");
  }

  if (Array.isArray(object.contains) && object.contains.length === 0) {
    reader.fail(`${pointer}/contains`, "`contains` lists at least one text");
  }

  return {
    ...(object.equals === undefined
      ? {}
      : { equals: stringAt(reader, object.equals, `${pointer}/equals`) }),
    ...(object.contains === undefined
      ? {}
      : {
          contains: arrayAt(reader, object.contains, `${pointer}/contains`).map((part, index) =>
            stringAt(reader, part, `${pointer}/contains/${index}`),
          ),
        }),
    ...(object.excludes === undefined
      ? {}
      : { excludes: stringAt(reader, object.excludes, `${pointer}/excludes`) }),
    ...(object.absent === true ? { absent: true } : {}),
  };
}

function objectAt(
  reader: Reader,
  value: unknown,
  pointer: string,
  allowedMembers: readonly string[] | undefined,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return reader.fail(pointer, "expected a JSON object");
  }

  const object: Record<string, unknown> = { ...value };

  for (const member of Object.keys(object)) {
    if (allowedMembers !== undefined && !allowedMembers.includes(member)) {
      reader.fail(
        `${pointer}/${member}`,
        `unknown member; use one of ${allowedMembers.join(", ")}`,
      );
    }
  }

  return object;
}

function arrayAt(reader: Reader, value: unknown, pointer: string): unknown[] {
  if (!Array.isArray(value)) return reader.fail(pointer, "expected a JSON array");

  return [...value];
}

function stringAt(reader: Reader, value: unknown, pointer: string): string {
  if (typeof value !== "string") return reader.fail(pointer, "expected a string");

  return value;
}

function patternAt(reader: Reader, value: unknown, pointer: string, pattern: RegExp): string {
  const text = stringAt(reader, value, pointer);

  if (!pattern.test(text)) reader.fail(pointer, `'${text}' does not match ${pattern.source}`);

  return text;
}

function stringMapAt(reader: Reader, value: unknown, pointer: string): Record<string, string> {
  const object = objectAt(reader, value, pointer, undefined);

  return Object.fromEntries(
    Object.entries(object).map(([member, text]) => [
      member,
      stringAt(reader, text, `${pointer}/${member}`),
    ]),
  );
}

function jsonObjectAt(
  reader: Reader,
  value: unknown,
  pointer: string,
): { [member: string]: JsonValue } {
  const object = objectAt(reader, value, pointer, undefined);

  return Object.fromEntries(
    Object.entries(object).map(([member, item]) => [
      member,
      jsonAt(reader, item, `${pointer}/${member}`),
    ]),
  );
}

// A copy of a parsed JSON value, so a case never shares its members with the caller's object.
function jsonAt(reader: Reader, value: unknown, pointer: string): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : reader.fail(pointer, "expected a finite number");
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => jsonAt(reader, item, `${pointer}/${index}`));
  }

  return jsonObjectAt(reader, value, pointer);
}
