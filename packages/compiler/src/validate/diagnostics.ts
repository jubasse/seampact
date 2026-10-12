// Ajv errors turned into located diagnostics: one per problem, never one per failed subschema.
// The authoring schemas mark the definitions whose failures have their own rule by `title`
// (packages/spec/src/authoring/dsl.ts); everything else falls back on the Ajv keyword.

import { NAME_TITLES, schemaKeyword } from "@seampact/spec/authoring";
import type { Origin } from "@seampact/spec/ir";
import type { ErrorObject } from "ajv";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { validateRules } from "./rules.js";
import { closestKeyword } from "./suggest.js";

type SchemaNode = { [key: string]: unknown };

// Objects whose missing key is a missing reason: `access: {}`, `csrf: {}`, `idempotency: {}`.
const REASON_HOLDERS = new Set([
  "access",
  "csrf exemption",
  "idempotency exemption",
  "query exception",
]);
const NAME_TITLE_SET: ReadonlySet<string> = new Set(NAME_TITLES);
const POLICY_REASONS = new Set(["ignore", "keep"]);

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
    return `'${lastSegment(parent)}[${segment}]'`;
  }
  return `'${segment}'`;
}

// The reasoned form a holder of a safety exception takes, for the fix.
const HOLDER_FORMS: Record<string, string> = {
  access: 'access: { public: "<reason>" } or access: { optionalAuth: "<reason>" }',
  "csrf exemption": 'csrf: { exempt: "<reason>" }',
  "idempotency exemption": 'idempotency: { exempt: "<reason>" }',
  "query exception": 'unknownQuery: { ignore: "<reason>" }',
};

// The subject of a sentence about the value at `pointer`.
function subjectOf(pointer: string): string {
  return pointer === "" ? "The file" : `'${lastSegment(pointer)}'`;
}

function title(e: ErrorObject): string | undefined {
  const t = (e.parentSchema as SchemaNode | undefined)?.title;
  return typeof t === "string" ? t : undefined;
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
  const known = knownKeywords(e);
  const closest = closestKeyword(key, known);
  let message = `'${key}' is not a keyword of ${where(e.instancePath)}.`;
  if (context.isPackRoot && e.instancePath === "") {
    message = `'${key}' is not a key of a pack: a pack is data only, its manifest, catalogues, conventions, formats, extensions, lint and derive (ADR 0008).`;
  } else if (key.startsWith("x-")) {
    message = `'${key}' is not an extension key of ${where(e.instancePath)}: an extension is written x-<prefix>-<key> where its declaration's 'at' allows it.`;
  }
  if (context.isPackRoot && e.instancePath === "" && key === "packs") {
    return {
      rule: validateRules.unknownKeyword,
      pointer,
      message,
      fix: "List the packs this pack builds on in 'pack.extends'.",
    };
  }
  const fix =
    closest !== undefined
      ? `Did you mean '${closest}'?`
      : `Remove '${key}'${known.length > 0 && known.length <= 12 ? `; the keywords here are ${known.join(", ")}` : ""}.`;
  return { rule: validateRules.unknownKeyword, pointer, message, fix };
}

function refusedKeyword(e: ErrorObject, form: boolean): Problem {
  const keyword = lastSegment(e.instancePath);
  const entry = schemaKeyword(keyword);
  const decided = form ? entry?.refusedForm : entry;
  if (decided === undefined) {
    return {
      rule: validateRules.refusedKeyword,
      pointer: e.instancePath,
      message: `'${keyword}' is refused in a schema.`,
      fix: `Remove '${keyword}'.`,
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

function reasonRequired(pointer: string, what: string): Problem {
  return {
    rule: validateRules.reasonRequired,
    pointer,
    message: `${what} needs a reason: a safety exception states why, in a non-empty string (A40).`,
    fix: `Write the reason as a string: ${exampleFor(lastSegment(pointer))}.`,
  };
}

function exampleFor(key: string): string {
  switch (key) {
    case "ignore":
    case "keep":
      return `{ ${key}: "<reason>" }`;
    case "unknownQuery":
    case "unknownKeys":
      return '{ ignore: "<reason>" }';
    default:
      return `${key || "reason"}: "<reason>"`;
  }
}

function convertOne(e: ErrorObject, context: ConvertContext): Problem | undefined {
  const t = title(e);
  const key = lastSegment(e.instancePath);
  switch (e.keyword) {
    case "if":
      return undefined;
    case "additionalProperties":
      return unknownKeyword(e, context);
    case "not":
      if (t === "refused") return refusedKeyword(e, false);
      if (t === "refused form") return refusedKeyword(e, true);
      if (t === "reasoned policy") break;
      if (t === "conflict") {
        return {
          rule: validateRules.conflictingKeywords,
          pointer: e.instancePath,
          message: `'${key}' cannot be written here: ${description(e)}.`,
          fix: `Remove '${key}', or the keyword it conflicts with.`,
        };
      }
      if (t === "reserved") {
        return {
          rule: validateRules.invalidName,
          pointer: e.instancePath,
          message: sentence(description(e)),
          fix: "Choose another prefix.",
        };
      }
      break;
    case "required": {
      const missing = String((e.params as { missingProperty: string }).missingProperty);
      if (t !== undefined && REASON_HOLDERS.has(t)) {
        return {
          ...reasonRequired(e.instancePath, `'${key}'`),
          fix: `Write ${HOLDER_FORMS[t] ?? `${key}: "<reason>"`}.`,
        };
      }
      if (t === "node marker") {
        return {
          rule: validateRules.missingKeyword,
          pointer: e.instancePath,
          message: `Node ${where(e.instancePath)} states no kind: a node is a route ('method'), a collection or a single ('kind'), or a relay route ('relays') (ADR 0002 section 6).`,
          fix: "Add 'method', 'kind: collection', 'kind: single' or, in a surface root's routes, 'relays'.",
        };
      }
      return {
        rule: validateRules.missingKeyword,
        pointer: e.instancePath,
        message: `${subjectOf(e.instancePath)} needs '${missing}'.`,
        fix: `Add '${missing}'.`,
      };
    }
    case "propertyNames": {
      const name = String((e.params as { propertyName: string }).propertyName);
      const schema = e.schema as SchemaNode;
      const what = typeof schema.description === "string" ? schema.description : "a valid key";
      return {
        rule: validateRules.invalidName,
        pointer: `${e.instancePath}/${escapePointer(name)}`,
        message:
          name === "$include"
            ? `'$include' cannot be a key of ${where(e.instancePath)}: every child of a routes map is named in its parent (ADR 0002 section 2).`
            : `'${name}' is not ${what} (ADR 0002 section 4).`,
        fix:
          name === "$include"
            ? "Write the child's name, then '$include' under it: '<name>: { $include: <path> }'."
            : `Rename it to match ${String(schema.pattern)}.`,
      };
    }
    default:
      break;
  }
  if (t === "reasoned policy") {
    if (typeof e.data === "string" && POLICY_REASONS.has(e.data)) {
      return {
        ...reasonRequired(e.instancePath, `'${key}: ${e.data}'`),
        fix: `Write the reason as a string: ${key}: { ${e.data}: "<reason>" }.`,
      };
    }
  }
  if (t === "reason") return reasonRequired(e.instancePath, `'${key}'`);
  if (e.keyword === "pattern" && t !== undefined && NAME_TITLE_SET.has(t)) {
    return {
      rule: validateRules.invalidName,
      pointer: e.instancePath,
      message: `${JSON.stringify(e.data)} is not a valid ${t}: ${lowerFirst(description(e))}.`,
      fix: `Write a ${t} that matches ${String((e.params as { pattern: string }).pattern)}.`,
    };
  }
  if (e.keyword === "type") {
    return {
      rule: validateRules.wrongType,
      pointer: e.instancePath,
      message: `${subjectOf(e.instancePath)} must be ${article(String((e.params as { type: string }).type))}.`,
      fix: `Write ${article(String((e.params as { type: string }).type))}.`,
    };
  }
  if (e.keyword === "minProperties" && t === "derive entry") {
    return {
      rule: validateRules.missingKeyword,
      pointer: e.instancePath,
      message: "A derive entry needs at least one effect (ADR 0002 section 2).",
      fix: "Add 'declareRight', 'require' or 'attachErrors'.",
    };
  }
  return invalidValue(e);
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
  if (e.keyword === "enum") {
    const allowed = (e.params as { allowedValues: unknown[] }).allowedValues.map((v) =>
      JSON.stringify(v),
    );
    return {
      rule: validateRules.invalidValue,
      pointer: e.instancePath,
      message: `${subject} is ${JSON.stringify(e.data)}, not one of its values.`,
      fix: `Write one of ${allowed.join(", ")}.`,
    };
  }
  if (e.keyword === "pattern") {
    const what =
      description(e) || `a value matching ${String((e.params as { pattern: string }).pattern)}`;
    return {
      rule: validateRules.invalidValue,
      pointer: e.instancePath,
      message: `${subject} is ${JSON.stringify(e.data)}, which is not ${what.charAt(0).toLowerCase()}${what.slice(1)}.`,
      fix: `Write ${what.charAt(0).toLowerCase()}${what.slice(1)}.`,
    };
  }
  return {
    rule: validateRules.invalidValue,
    pointer: e.instancePath,
    message: `${subject} ${e.message ?? "is invalid"}.`,
    fix: `Change ${subject === "The file" ? "the file" : subject} so that it ${e.message ?? "is valid"}.`,
  };
}

// Ajv errors of one document, as diagnostics of one layer.
export function convertErrors(
  errors: readonly ErrorObject[],
  context: ConvertContext,
): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  // A key refused by its name is one problem: its value is not checked further.
  const badKeys = errors
    .filter((e) => e.keyword === "propertyNames")
    .map(
      (e) =>
        `${e.instancePath}/${escapePointer(String((e.params as { propertyName: string }).propertyName))}`,
    );
  const underBadKey = (pointer: string): boolean =>
    badKeys.some((k) => pointer === k || pointer.startsWith(`${k}/`));
  for (const e of errors) {
    if (e.keyword !== "propertyNames" && underBadKey(e.instancePath)) continue;
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
