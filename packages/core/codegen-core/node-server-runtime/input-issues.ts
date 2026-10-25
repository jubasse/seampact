// The request as the validators link receives it, its validation in one pass, and each issue named by the
// contract's rules (ADR 0006 section 6). Read by step 6, and earlier by the scope ids (step 4) and the body proofs
// (step 5), which are validated before a hook receives them. Copied into the generated tree as is.
import type { CheckState } from "./access-checks.js";
import { type ContractError, MAX_RENDERED_ISSUES, roleError } from "./contract-error.js";
import {
  type ContractRoute,
  decodeRequestParams,
  type PagingEntry,
  type StandardIssue,
} from "./contract-route.js";
import { beforeParamSentWithAfter } from "./cursor-exclusion.js";
import { isPlainObject } from "./plain-object.js";

const SCHEMA_INVALID_ROLE = "schemaInvalid";
const FALLBACK_RULE = "invalid";
const ENUM_RULE = "enum";
const EXCLUSIVE_CURSORS_RULE = "exclusiveCursors";

// The validator input's parts, as an issue's `in` names them (ADR 0006 section 6).
const ISSUE_PARTS = {
  path: "path",
  query: "query",
  headers: "header",
  body: "body",
} as const;

const ISSUE_PART_NAMES: ReadonlyMap<string, string> = new Map(Object.entries(ISSUE_PARTS));

export type RequestPart = keyof typeof ISSUE_PARTS;

/** One `schemaInvalid` issue: the input part, the pointer inside it and the contract's rule name. */
export interface InputIssue {
  readonly in: string;
  readonly pointer: string;
  readonly rule: string;
}

/** The validator's input, path, query and header strings decoded by their wire forms. */
export interface RequestCandidate {
  readonly path: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
}

/** The request validated once: the validated input when there is no issue, else every issue. */
export interface RequestValidation {
  readonly candidate: RequestCandidate;
  readonly value?: unknown;
  readonly issues: readonly InputIssue[];
}

/** Validates the whole request; a sort value off the declared keys fails its pattern like any input. */
export async function validateRequest(state: CheckState): Promise<RequestValidation> {
  const { route, request } = state;
  const params = decodeRequestParams(route, request, state.pathParams);
  const candidate: RequestCandidate =
    route.input === undefined ? params : { ...params, body: request.body };
  const result = await route.validator["~standard"].validate(candidate);
  const exclusiveIssues = bothCursorsIssues(route.paging, candidate.query);

  if (result.issues === undefined && exclusiveIssues.length === 0) {
    return { candidate, value: result.value, issues: [] };
  }

  return {
    candidate,
    issues: [
      ...(result.issues === undefined ? [] : inputIssues(candidate, result.issues)),
      ...exclusiveIssues,
    ],
  };
}

function bothCursorsIssues(
  paging: PagingEntry | undefined,
  query: Readonly<Record<string, unknown>>,
): InputIssue[] {
  const beforeParam = beforeParamSentWithAfter(paging, query);

  if (beforeParam === undefined) return [];

  return [
    { in: ISSUE_PARTS.query, pointer: jsonPointer([beforeParam]), rule: EXCLUSIVE_CURSORS_RULE },
  ];
}

/** The issues on one member of a part: at it, below it, or on a value that holds it. */
export function issuesOnMember(
  validation: RequestValidation,
  part: RequestPart,
  member: string,
): InputIssue[] {
  const pointer = jsonPointer([member]);

  return validation.issues.filter(
    (issue) =>
      issue.in === ISSUE_PARTS[part] &&
      (issue.pointer === pointer ||
        issue.pointer.startsWith(`${pointer}/`) ||
        pointer.startsWith(`${issue.pointer}/`)),
  );
}

/** The operation's `schemaInvalid` refusal with its issues, as many as the format renders. */
export function schemaInvalidError(
  route: ContractRoute,
  issues: readonly InputIssue[],
): ContractError {
  return roleError(route, SCHEMA_INVALID_ROLE, { issues: issues.slice(0, MAX_RENDERED_ISSUES) });
}

/** An issue's path as a JSON pointer, for a log line. */
export function issuePointer(issue: StandardIssue): string {
  return jsonPointer(issueKeys(issue));
}

function issueKeys(issue: StandardIssue): string[] {
  return (issue.path ?? []).map((segment) =>
    typeof segment === "object" ? String(segment.key) : String(segment),
  );
}

function jsonPointer(keys: readonly string[]): string {
  return keys.map((key) => `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

/** The validator's issues named by the contract's rules (`minLength`, `required`, ...), never the validator's codes. */
export function inputIssues(candidate: unknown, issues: readonly StandardIssue[]): InputIssue[] {
  return issues.flatMap((issue) => {
    const keys = issueKeys(issue);
    const code = issueMember(issue, "code");

    if (code === "unrecognized_keys") {
      const unknownKeys = issueMember(issue, "keys");

      return (Array.isArray(unknownKeys) ? unknownKeys : []).map((key) =>
        renderedIssue([...keys, String(key)], "unknownKeys"),
      );
    }

    return [renderedIssue(keys, contractRule(issue, valueAt(candidate, keys)))];
  });
}

function renderedIssue(keys: readonly string[], rule: string): InputIssue {
  const [part = "", ...inside] = keys;

  return { in: ISSUE_PART_NAMES.get(part) ?? part, pointer: jsonPointer(inside), rule };
}

function contractRule(issue: StandardIssue, value: unknown): string {
  const origin = issueMember(issue, "origin");
  const exclusive = issueMember(issue, "inclusive") === false;

  switch (issueMember(issue, "code")) {
    case "invalid_type":
      return value === undefined ? "required" : "type";
    case "too_small":
      return origin === "string"
        ? "minLength"
        : origin === "array" || origin === "set"
          ? "minItems"
          : exclusive
            ? "exclusiveMinimum"
            : "minimum";
    case "too_big":
      return origin === "string"
        ? "maxLength"
        : origin === "array" || origin === "set"
          ? "maxItems"
          : exclusive
            ? "exclusiveMaximum"
            : "maximum";
    // The validators link writes a regex only for a format; a `pattern` refinement is refused there.
    case "invalid_format":
      return "format";
    case "not_multiple_of":
      return "multipleOf";
    case "invalid_value":
      return ENUM_RULE;
    case "invalid_union":
      return "oneOf";
    case "invalid_key":
    case "invalid_element":
      return "type";
    case "custom":
      return customRule(issue);
    default:
      return FALLBACK_RULE;
  }
}

// The validators link names the contract rule of each custom check in its `params`.
function customRule(issue: StandardIssue): string {
  const params = issueMember(issue, "params");
  const rule = isPlainObject(params) ? params.rule : undefined;

  return typeof rule === "string" ? rule : FALLBACK_RULE;
}

function issueMember(issue: StandardIssue, name: string): unknown {
  return Reflect.get(issue, name);
}

function valueAt(value: unknown, keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (current, key) =>
      Array.isArray(current)
        ? current[Number(key)]
        : isPlainObject(current)
          ? current[key]
          : undefined,
    value,
  );
}
