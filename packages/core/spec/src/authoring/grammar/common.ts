// Definitions shared by every authoring schema: paths, docs, reasons, scalars, names and value
// sources (ADR 0002 sections 2 and 4).

import {
  A2,
  forbid,
  type JsonSchema,
  kw,
  list,
  map,
  NOT_RESERVED,
  object,
  oneOfValues,
  ref,
  req,
  str,
  stringOr,
  when,
} from "../dsl.js";
import { MARKERS, type Marker } from "../markers.js";

const NAME = "[a-z][A-Za-z0-9_]*";
const SCHEMA_NAME = "[A-Z][A-Za-z0-9]*";
const SCALAR_NAME = "[a-z][A-Za-z0-9]*(?:-[a-z0-9]+)*";

// The characters no authored path, pointer, pack reference or right name holds, inside a regex
// class: C0, DEL and C1 controls, the bidi controls (ALM, LRM, RLM, LRE to RLO, LRI to PDI) and the
// line and paragraph separators. The validate stage escapes the same set when it prints a value.
export const CONTROL =
  "\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\u2028\\u2029";

const RIGHT_NAME = `[^\\s${CONTROL}](?:[^${CONTROL}]*[^\\s${CONTROL}])?`;
const ERROR_CODE = "[A-Za-z0-9][A-Za-z0-9._-]*";
const HEADER_NAME = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const RULE_ID = "[^\\s/]+(?:/[^\\s/]+)+";

// Key patterns (unanchored) for `map`.
export const KEYS = {
  name: NAME,
  schemaName: SCHEMA_NAME,
  scalarName: SCALAR_NAME,
  rightName: RIGHT_NAME,
  errorCode: ERROR_CODE,
  headerName: HEADER_NAME,
  ruleId: RULE_ID,
  extensionPrefix: "[a-z][a-z0-9]*",
  extensionKey: "[a-z][a-z0-9]*(?:-[a-z0-9]+)*",
} as const;

// A relative path: './' or '../', then no backslash, '#' or `CONTROL` character. Containment in the
// workspace root is the loader's check; this is defence in depth for editors and the stage.
export const PATH = `\\.\\.?/[^\\\\#${CONTROL}]+`;
// A JSON Pointer after a path's '#', without `CONTROL` characters.
export const POINTER = `#/[^${CONTROL}]*`;

// Value sources (ADR 0002 section 4), one pattern per form.
const SOURCE = {
  path: "path\\.[^.\\s]+",
  query: "query\\.[^.\\s]+",
  header: `header\\.${HEADER_NAME}`,
  body: "body\\.[^.\\s]+(?:\\.[^.\\s]+)*",
  principal: "principal\\.[^.\\s]+(?:\\.[^.\\s]+)*",
  scope: `scope\\.${NAME}`,
  host: "host",
  subdomain: "subdomain",
  address: "address(?:/[0-9]{1,3})?",
  resolver: "resolver",
} as const;

type SourceForm = keyof typeof SOURCE;

const SOURCE_SPELLING: Record<SourceForm, string> = {
  path: "path.<param>",
  query: "query.<param>",
  header: "header.<Name>",
  body: "body.<field>",
  principal: "principal.<field>",
  scope: "scope.<scope>",
  host: "host",
  subdomain: "subdomain",
  address: "address, address/<bits>",
  resolver: "resolver",
};

function source(description: string, forms: SourceForm[]): JsonSchema {
  return {
    title: "value source",
    description: `${description}: ${forms.map((f) => SOURCE_SPELLING[f]).join(", ")} (ADR 0002 section 4).`,
    type: "string",
    pattern: `^(?:${forms.map((f) => SOURCE[f]).join("|")})$`,
  };
}

// `{ ignore: "<reason>" }` or `{ keep: "<reason>" }`: one of the two, never both; neither is a
// missing reason.
function unknownKeysException(section: string): JsonSchema {
  return object({
    title: MARKERS.unknownKeysException,
    props: {
      ignore: kw(section, ref("common", "reason")),
      keep: kw(section, ref("common", "reason")),
    },
    rules: [
      {
        ...when(req("ignore"), forbid(["keep"], "Write 'ignore' or 'keep', not both."), {
          ...when(req("$include"), undefined, {
            ...req("keep"),
            title: MARKERS.unknownKeysException,
          }),
        }),
      },
    ],
  });
}

function name(title: Marker, pattern: string, description: string): JsonSchema {
  return { title, description, type: "string", pattern: `^${pattern}$` };
}

export function commonDefs(): Record<string, JsonSchema> {
  return {
    path: {
      title: "path",
      description:
        "A path relative to the file that holds it, starting with './' or '../', with forward slashes (ADR 0002 section 1).",
      type: "string",
      pattern: `^${PATH}$`,
    },
    pointerPath: {
      title: "path",
      description:
        "A relative path, optionally followed by '#' and a JSON Pointer into that file (ADR 0002 section 2).",
      type: "string",
      pattern: `^${PATH}(?:${POINTER})?$`,
    },
    include: kw(
      A2(2),
      stringOr(
        ref("common", "pointerPath"),
        list(ref("common", "pointerPath"), { minItems: 1 }),
        "array",
      ),
      "Merges the mapping of each file in place of this key, in list order (ADR 0002 section 2).",
    ),
    file: object({
      description: "Replaces this value with a file's content (ADR 0002 section 2).",
      props: { $file: kw(A2(2), ref("common", "path")) },
      required: ["$file"],
    }),
    summary: kw(A2(12), str(), "Docs: one line."),
    description: kw(
      A2(12),
      stringOr(str(), ref("common", "file")),
      "Docs: a string, or { $file: <path> } to a .md or .txt file.",
    ),
    reason: {
      title: MARKERS.reason,
      description:
        "A reason: a non-empty string. Required on every safety exception, and only there (ADR 0002 section 4, A40).",
      type: "string",
      minLength: 1,
      pattern: "\\S",
    },
    duration: {
      title: "duration",
      description: "An integer followed by ms, s, m, h or d: 300ms, 15m, 24h (ADR 0002 section 4).",
      type: "string",
      pattern: "^[0-9]+(?:ms|s|m|h|d)$",
    },
    size: {
      title: "size",
      description: "An integer followed by B, KiB or MiB: 1MiB (ADR 0002 section 4).",
      type: "string",
      pattern: "^[0-9]+(?:B|KiB|MiB)$",
    },
    date: {
      title: "date",
      description: "A quoted ISO 8601 date: '2027-06-30' (ADR 0002 section 4).",
      type: "string",
      pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    },
    name: name(
      MARKERS.name,
      NAME,
      "A lowercase letter, then letters, digits or '_': tasks, viewer_or_device (ADR 0002 section 4).",
    ),
    schemaName: name(
      MARKERS.schemaName,
      SCHEMA_NAME,
      "An uppercase letter, then letters or digits: Task, TaskId (ADR 0002 section 4).",
    ),
    scalarName: name(
      MARKERS.scalarName,
      SCALAR_NAME,
      "A named format: money, iri-reference (ADR 0002 section 4).",
    ),
    rightName: {
      ...name(
        MARKERS.rightName,
        RIGHT_NAME,
        "Any non-empty string without control characters and without leading or trailing space (ADR 0002 section 4); not __proto__, constructor or prototype.",
      ),
      ...NOT_RESERVED,
    },
    errorCode: name(
      MARKERS.errorCode,
      ERROR_CODE,
      "A letter or digit, then letters, digits, '.', '_' or '-': api.forbidden, E1042 (ADR 0002 section 4).",
    ),
    headerName: name(MARKERS.headerName, HEADER_NAME, "An HTTP header name."),
    ruleId: name(MARKERS.ruleId, RULE_ID, "A lint rule id: seampact/<rule> or <plugin>/<rule>."),
    errorCodes: list(ref("common", "errorCode")),
    names: list(ref("common", "name")),
    method: oneOfValues("get", "post", "put", "patch", "delete"),
    maturityLevel: oneOfValues("experimental", "provisional", "stable"),
    // ADR 0002 section 13: a template describes a JSON value the boundary writes; its slots are
    // checked by the compiler.
    template: {
      title: "template",
      description:
        "A template: a JSON value whose '$<slot>' strings the boundary fills (ADR 0002 section 13).",
    },
    unknownKeysPolicy: {
      title: "unknown keys policy",
      description:
        'refuse (the default), { ignore: "<reason>" } or { keep: "<reason>" } (ADR 0003 section 4).',
      ...stringOr(
        { title: MARKERS.reasonedPolicy, enum: ["refuse"] },
        unknownKeysException("ADR 0003 section 4"),
      ),
    },
    unknownKeysException: {
      title: "unknown keys policy",
      description: '{ ignore: "<reason>" } or { keep: "<reason>" } (ADR 0002 section 9).',
      ...stringOr({ title: MARKERS.reasonedPolicy, not: {} }, unknownKeysException(A2(9))),
    },
    unknownQueryPolicy: {
      title: "unknown query policy",
      description: 'refuse, or { ignore: "<reason>" } (ADR 0002 section 7).',
      ...stringOr(
        { title: MARKERS.reasonedPolicy, enum: ["refuse"] },
        object({
          title: MARKERS.queryException,
          props: { ignore: kw(A2(7), ref("common", "reason")) },
          required: ["ignore"],
        }),
      ),
    },
    // A node's or an element's `lint` (ADR 0002 section 12).
    lintAllow: object({
      props: {
        allow: kw(
          A2(12),
          map({
            keys: RULE_ID,
            keyDescription: "a lint rule id",
            keySection: A2(12),
            values: ref("common", "reason"),
          }),
          "Silences one lint rule here, with a reason.",
        ),
      },
    }),
    // A file's `lint` (ADR 0002 section 12).
    lintRules: object({
      props: {
        rules: kw(
          A2(12),
          map({
            keys: RULE_ID,
            keyDescription: "a lint rule id",
            keySection: A2(12),
            values: oneOfValues("disabled", "warning", "error"),
          }),
          "Each rule's severity: disabled, warning or error.",
        ),
      },
    }),
    // Value sources, per use (ADR 0002 section 4).
    subjectSource: source("A requirement subject", [
      "path",
      "query",
      "header",
      "principal",
      "scope",
    ]),
    scopeSource: source("A scope id", [
      "path",
      "query",
      "header",
      "host",
      "subdomain",
      "principal",
      "resolver",
    ]),
    bindingKey: source("A binding key", ["path", "query", "body"]),
    bindingValue: source("A binding value", ["principal"]),
    concurrencySource: source("A version source", ["body", "query", "header"]),
    bucketKeySource: source("A bucket key", ["address", "principal", "body"]),
    signatureKeySource: source("A signature key", ["path", "query", "header"]),
    discriminatorSource: source("A union tag source", ["header"]),
    principalSource: source("A principal field", ["principal"]),
  };
}
