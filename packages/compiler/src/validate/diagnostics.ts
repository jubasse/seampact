// Ajv errors turned into located diagnostics: one per problem, never one per failed subschema.
// The authoring schemas mark the definitions whose failures have their own rule by a title of
// `MARKERS` (@seampact/spec/authoring); everything else falls back on the Ajv keyword.
//
// Every authored value (a key, a string, a number) reaches a message or a fix through `quote`, which
// escapes control, bidi and line-separator characters and bounds the length: a contract file is
// untrusted input, and a message is printed to a terminal.

import { isMarker, type Marker, schemaKeyword } from "@seampact/spec/authoring";
import type { Origin } from "@seampact/spec/ir";
import type { ErrorObject } from "ajv";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { validateRules } from "./rules.js";
import { closestKeyword } from "./suggest.js";

type SchemaNode = { [key: string]: unknown };

// How the converter treats a marked definition; a marker without a role is a type error.
type Role =
  | "refused"
  | "refusedForm"
  | "conflict"
  | "reserved"
  | "reason"
  | "reasonedPolicy"
  | "reasonHolder"
  | "nodeMarker"
  | "deriveEntry"
  | "choice"
  | "alternatives"
  | "routes"
  | "name";

const ROLES: Record<Marker, Role> = {
  refused: "refused",
  "refused form": "refusedForm",
  conflict: "conflict",
  reserved: "reserved",
  reason: "reason",
  "reasoned policy": "reasonedPolicy",
  access: "reasonHolder",
  "csrf exemption": "reasonHolder",
  "idempotency exemption": "reasonHolder",
  "query exception": "reasonHolder",
  "unknown keys exception": "reasonHolder",
  "node marker": "nodeMarker",
  "derive entry": "deriveEntry",
  choice: "choice",
  alternatives: "alternatives",
  routes: "routes",
  name: "name",
  "schema name": "name",
  "scalar name": "name",
  "right name": "name",
  "error code": "name",
  "header name": "name",
  "rule id": "name",
  "schema reference": "name",
};

// The reasoned form of a mapping whose missing key is a missing reason, for the fix.
const HOLDER_FORMS: Partial<Record<Marker, string>> = {
  access: 'access: { public: "<reason>" } or access: { optionalAuth: "<reason>" }',
  "csrf exemption": 'csrf: { exempt: "<reason>" }',
  "idempotency exemption": 'idempotency: { exempt: "<reason>" }',
  "query exception": 'unknownQuery: { ignore: "<reason>" }',
  "unknown keys exception": 'unknownKeys: { ignore: "<reason>" } or { keep: "<reason>" }',
};

const POLICY_REASONS = new Set(["ignore", "keep"]);

// Converting stops after this many diagnostics: a file far from the grammar gives a bounded report.
export const MAX_DIAGNOSTICS = 200;
// Longer authored values are cut in messages; longer keys get no closest-keyword search.
const QUOTE_LIMIT = 80;
const SUGGEST_LIMIT = 64;

// C0, DEL and C1 controls, the bidi controls (ALM, LRM, RLM, LRE to RLO, LRI to PDI) and the line
// and paragraph separators.
function unsafe(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x2028 ||
    code === 0x2029
  );
}

// An authored value, printable: a string quoted, unsafe characters escaped as \uXXXX, at most about
// 80 characters.
export function quote(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  const chars = Array.from(text);
  const kept = chars.length > QUOTE_LIMIT ? chars.slice(0, QUOTE_LIMIT) : chars;
  const safe = kept
    .map((c) => {
      const code = c.codePointAt(0) ?? 0;
      return unsafe(code) ? `\\u${code.toString(16).toUpperCase().padStart(4, "0")}` : c;
    })
    .join("");
  const shown = chars.length > QUOTE_LIMIT ? `${safe}…` : safe;
  return typeof value === "string" ? `'${shown}'` : shown;
}

export interface ConvertContext {
  layer: Origin["layer"];
  // The pack root refuses code and unknown keys (ADR 0008, SCN-047).
  isPackRoot: boolean;
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function lastSegment(pointer: string): string {
  const i = pointer.lastIndexOf("/");
  return i < 0
    ? ""
    : pointer
        .slice(i + 1)
        .replaceAll("~1", "/")
        .replaceAll("~0", "~");
}

// How a message names the mapping at `pointer`: its key, or its list and index.
function where(pointer: string): string {
  if (pointer === "") return "the file's root";
  const segment = lastSegment(pointer);
  if (/^[0-9]+$/.test(segment)) {
    const parent = pointer.slice(0, pointer.lastIndexOf("/"));
    return `${quote(lastSegment(parent))}[${segment}]`;
  }
  return quote(segment);
}

// The subject of a sentence about the value at `pointer`.
function subjectOf(pointer: string): string {
  return pointer === "" ? "The file" : quote(lastSegment(pointer));
}

function markerOf(e: ErrorObject): Marker | undefined {
  const t = (e.parentSchema as SchemaNode | undefined)?.title;
  return isMarker(t) ? t : undefined;
}

function description(e: ErrorObject): string {
  const d = (e.parentSchema as SchemaNode | undefined)?.description;
  return typeof d === "string" ? d.replace(/\.$/, "") : "";
}

function knownKeywords(e: ErrorObject): string[] {
  const properties = (e.parentSchema as SchemaNode | undefined)?.properties as
    | Record<string, SchemaNode>
    | undefined;
  if (properties === undefined) return [];
  return Object.entries(properties)
    .filter(([k, v]) => k !== "$include" && v?.title !== "refused")
    .map(([k]) => k)
    .sort();
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function sentence(text: string): string {
  const t = text.trim();
  const capital = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

interface Problem {
  rule: string;
  pointer: string;
  message: string;
  fix: string;
}

function unknownKeyword(e: ErrorObject, context: ConvertContext): Problem {
  const key = String((e.params as { additionalProperty: string }).additionalProperty);
  const pointer = `${e.instancePath}/${escapePointer(key)}`;
  const rule = validateRules.unknownKeyword;
  const atPackRoot = context.isPackRoot && e.instancePath === "";
  let message = `${quote(key)} is not a keyword of ${where(e.instancePath)}.`;
  if (atPackRoot) {
    message = `${quote(key)} is not a key of a pack: a pack is data only, its manifest, catalogues, conventions, formats, extensions, lint and derive (ADR 0008).`;
  } else if (key.startsWith("x-")) {
    message = `${quote(key)} is not an extension key of ${where(e.instancePath)}: an extension is written x-<prefix>-<key> where its declaration's 'at' allows it.`;
  }
  if (atPackRoot && key === "packs") {
    return { rule, pointer, message, fix: "List the packs this pack builds on in 'pack.extends'." };
  }
  const known = knownKeywords(e);
  const closest = key.length <= SUGGEST_LIMIT ? closestKeyword(key, known) : undefined;
  const fix =
    closest !== undefined
      ? `Did you mean '${closest}'?`
      : `Remove ${quote(key)}${known.length > 0 && known.length <= 12 ? `; the keywords here are ${known.join(", ")}` : ""}.`;
  return { rule, pointer, message, fix };
}

function refusedKeyword(e: ErrorObject, form: boolean): Problem {
  const keyword = lastSegment(e.instancePath);
  const entry = schemaKeyword(keyword);
  const decided = form ? entry?.refusedForm : entry;
  if (decided === undefined) {
    return {
      rule: validateRules.refusedKeyword,
      pointer: e.instancePath,
      message: `${quote(keyword)} is refused in a schema.`,
      fix: `Remove ${quote(keyword)}.`,
    };
  }
  return {
    rule: validateRules.refusedKeyword,
    pointer: e.instancePath,
    message: form
      ? `This form of '${keyword}' is refused in a schema: ${decided.reason} (ADR 0003 section 1).`
      : `'${keyword}' is refused in a schema: ${decided.reason} (ADR 0003 section 1).`,
    fix: sentence(decided.fix),
  };
}

function reasonRequired(pointer: string, what: string, fix?: string): Problem {
  return {
    rule: validateRules.reasonRequired,
    pointer,
    message: `${what} needs a reason: a safety exception states why, in a non-empty string (A40).`,
    fix: fix ?? `Write the reason as a string: ${exampleFor(lastSegment(pointer))}.`,
  };
}

// The reasoned spelling of a key; only grammar keys reach it (`public`, `exempt`, `guest`).
function exampleFor(key: string): string {
  switch (key) {
    case "ignore":
    case "keep":
      return `{ ${key}: "<reason>" }`;
    case "unknownQuery":
    case "unknownKeys":
      return '{ ignore: "<reason>" }';
    default:
      return /^[A-Za-z]+$/.test(key) ? `${key}: "<reason>"` : '"<reason>"';
  }
}

// A failure under a marked definition, by the marker's role; `undefined` falls back on the keyword.
function convertMarked(e: ErrorObject, marker: Marker): Problem | undefined {
  const key = lastSegment(e.instancePath);
  const pointer = e.instancePath;
  switch (ROLES[marker]) {
    case "refused":
      return e.keyword === "not" ? refusedKeyword(e, false) : undefined;
    case "refusedForm":
      return e.keyword === "not" ? refusedKeyword(e, true) : undefined;
    case "conflict":
      if (e.keyword !== "not") return undefined;
      return {
        rule: validateRules.conflictingKeywords,
        pointer,
        message: `${quote(key)} cannot be written here: ${description(e)}.`,
        fix: `Remove ${quote(key)}, or the keyword it conflicts with.`,
      };
    case "reserved":
      if (e.keyword !== "not") return undefined;
      return {
        rule: validateRules.invalidName,
        pointer,
        message: sentence(description(e)),
        fix: "Choose another prefix.",
      };
    case "reason":
      return reasonRequired(pointer, subjectOf(pointer));
    case "reasonedPolicy":
      if (typeof e.data === "string" && POLICY_REASONS.has(e.data)) {
        return reasonRequired(
          pointer,
          `'${key}: ${e.data}'`,
          `Write the reason as a string: ${key}: { ${e.data}: "<reason>" }.`,
        );
      }
      if (e.keyword === "not") {
        return {
          rule: validateRules.invalidValue,
          pointer,
          message: `${subjectOf(pointer)} takes no string here, only a reasoned exception.`,
          fix: `Write ${key}: { ignore: "<reason>" } or ${key}: { keep: "<reason>" }.`,
        };
      }
      return undefined;
    case "reasonHolder":
      if (e.keyword !== "required") return undefined;
      return reasonRequired(pointer, subjectOf(pointer), `Write ${HOLDER_FORMS[marker]}.`);
    case "nodeMarker":
      if (e.keyword !== "required") return undefined;
      return {
        rule: validateRules.missingKeyword,
        pointer,
        message: `Node ${where(pointer)} states no kind: a node is a route ('method'), a collection or a single ('kind'), or a relay route ('relays') (ADR 0002 section 6).`,
        fix: "Add 'method', 'kind: collection', 'kind: single' or, in a surface root's routes, 'relays'.",
      };
    case "deriveEntry":
      if (e.keyword !== "minProperties") return undefined;
      return {
        rule: validateRules.missingKeyword,
        pointer,
        message: "A derive entry needs at least one effect (ADR 0002 section 2).",
        fix: "Add 'declareRight', 'require' or 'attachErrors'.",
      };
    case "choice":
      if (e.keyword !== "required") return undefined;
      return {
        rule: validateRules.missingKeyword,
        pointer,
        message: `${subjectOf(pointer)} needs ${description(e)}.`,
        fix: `Add ${description(e)}.`,
      };
    case "alternatives":
      if (e.keyword !== "type") return undefined;
      return {
        rule: validateRules.wrongType,
        pointer,
        message: `${subjectOf(pointer)} must be ${description(e)}.`,
        fix: `Write ${description(e)}.`,
      };
    case "routes":
      return undefined;
    case "name":
      if (e.keyword !== "pattern") return undefined;
      return {
        rule: validateRules.invalidName,
        pointer,
        message: `${quote(e.data)} is not a valid ${marker}: ${lowerFirst(description(e))}.`,
        fix: `Write a ${marker} that matches ${String((e.params as { pattern: string }).pattern)}.`,
      };
  }
}

function invalidKey(e: ErrorObject): Problem {
  const name = String((e.params as { propertyName: string }).propertyName);
  const schema = e.schema as SchemaNode;
  const what = typeof schema.description === "string" ? schema.description : "a valid key";
  const pointer = `${e.instancePath}/${escapePointer(name)}`;
  if (name === "$include" && markerOf(e) === "routes") {
    return {
      rule: validateRules.invalidName,
      pointer,
      message: `'$include' cannot be a key of ${where(e.instancePath)}: every child of a routes map is named in its parent (ADR 0002 section 2).`,
      fix: "Write the child's name, then '$include' under it: '<name>: { $include: <path> }'.",
    };
  }
  return {
    rule: validateRules.invalidName,
    pointer,
    message: `${quote(name)} is not ${what}.`,
    fix: `Rename it to match ${String(schema.pattern)}.`,
  };
}

function convertOne(e: ErrorObject, context: ConvertContext): Problem | undefined {
  switch (e.keyword) {
    case "if":
      return undefined;
    case "additionalProperties":
      return unknownKeyword(e, context);
    case "propertyNames":
      return invalidKey(e);
    default:
      break;
  }
  const marker = markerOf(e);
  const marked = marker === undefined ? undefined : convertMarked(e, marker);
  if (marked !== undefined) return marked;
  const pointer = e.instancePath;
  const subject = subjectOf(pointer);
  switch (e.keyword) {
    case "required": {
      const missing = String((e.params as { missingProperty: string }).missingProperty);
      return {
        rule: validateRules.missingKeyword,
        pointer,
        message: `${subject} needs '${missing}'.`,
        fix: `Add '${missing}'.`,
      };
    }
    case "type": {
      const type = article(String((e.params as { type: string }).type));
      return {
        rule: validateRules.wrongType,
        pointer,
        message: `${subject} must be ${type}.`,
        fix: `Write ${type}.`,
      };
    }
    case "maxProperties": {
      const limit = Number((e.params as { limit: number }).limit);
      const keys = Object.keys((e.data as SchemaNode | null) ?? {}).filter((k) => k !== "$include");
      return {
        rule: validateRules.conflictingKeywords,
        pointer,
        message: `${subject} takes ${limit === 1 ? "one key" : `at most ${limit} keys`}, not ${keys.map(quote).join(", ")}.`,
        fix: `Keep ${limit === 1 ? "one of them" : `${limit} of them`}.`,
      };
    }
    case "const": {
      const allowed = JSON.stringify((e.params as { allowedValue: unknown }).allowedValue);
      return {
        rule: validateRules.invalidValue,
        pointer,
        message: `${subject} is ${quote(e.data)}; its one value is ${allowed}.`,
        fix: `Write ${allowed}, or remove ${subject}.`,
      };
    }
    case "not":
      return {
        rule: validateRules.invalidValue,
        pointer,
        message: `${subject} cannot be written here.`,
        fix: `Remove ${subject}.`,
      };
    default:
      return invalidValue(e);
  }
}

function article(type: string): string {
  const names: Record<string, string> = {
    object: "a mapping",
    array: "a list",
    string: "a string",
    integer: "an integer",
    number: "a number",
    boolean: "a boolean",
    null: "null",
  };
  return type
    .split(",")
    .map((t) => names[t] ?? t)
    .join(" or ");
}

function invalidValue(e: ErrorObject): Problem {
  const subject = subjectOf(e.instancePath);
  const pointer = e.instancePath;
  if (e.keyword === "enum") {
    const allowed = (e.params as { allowedValues: unknown[] }).allowedValues.map((v) =>
      JSON.stringify(v),
    );
    return {
      rule: validateRules.invalidValue,
      pointer,
      message: `${subject} is ${quote(e.data)}, not one of its values.`,
      fix: `Write one of ${allowed.join(", ")}.`,
    };
  }
  if (e.keyword === "pattern") {
    const what = lowerFirst(
      description(e) || `a value matching ${String((e.params as { pattern: string }).pattern)}`,
    );
    return {
      rule: validateRules.invalidValue,
      pointer,
      message: `${subject} is ${quote(e.data)}, which is not ${what}.`,
      fix: `Write ${what}.`,
    };
  }
  // Ajv's message for the remaining keywords names schema facts only (a bound, a length).
  return {
    rule: validateRules.invalidValue,
    pointer,
    message: `${subject} ${e.message ?? "is invalid"}.`,
    fix: `Change ${subject === "The file" ? "the file" : subject} so that it ${e.message ?? "is valid"}.`,
  };
}

// Whether `pointer` is one of `keys` or lies under one, walking up its parents.
function under(pointer: string, keys: ReadonlySet<string>): boolean {
  let p = pointer;
  for (;;) {
    if (keys.has(p)) return true;
    const i = p.lastIndexOf("/");
    if (i < 0) return false;
    p = p.slice(0, i);
  }
}

// Ajv errors of one document, as diagnostics of one layer, at most `MAX_DIAGNOSTICS`.
export function convertErrors(
  errors: readonly ErrorObject[],
  context: ConvertContext,
): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  // A key refused by its name is one problem: its value is not checked further.
  const badKeys = new Set(
    errors
      .filter((e) => e.keyword === "propertyNames")
      .map(
        (e) =>
          `${e.instancePath}/${escapePointer(String((e.params as { propertyName: string }).propertyName))}`,
      ),
  );
  for (const e of errors) {
    if (out.length >= MAX_DIAGNOSTICS) break;
    if (e.keyword !== "propertyNames" && badKeys.size > 0 && under(e.instancePath, badKeys)) {
      continue;
    }
    // The inner error of a failed `propertyNames`; the `propertyNames` error reports it.
    if ((e as { propertyName?: string }).propertyName !== undefined) continue;
    const problem = convertOne(e, context);
    if (problem === undefined) continue;
    const id = `${problem.rule}\u0000${problem.pointer}\u0000${problem.message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      severity: "error",
      rule: problem.rule,
      message: problem.message,
      fix: problem.fix,
      origin: { layer: context.layer, pointer: problem.pointer },
      related: [],
    });
  }
  return out;
}
