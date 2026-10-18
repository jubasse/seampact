// Steps 6 and 7 of the check order (ADR 0012): the whole request validated in one pass by the validators link,
// then restricted input fields. Copied into the generated tree as is.
import { type AccessGrant, type CheckState, decide } from "./access-checks.js";
import {
  ContractError,
  isPlainObject,
  MAX_RENDERED_ISSUES,
  roleError,
  roleParams,
} from "./contract-error.js";
import { type ContractRoute, decodeRequestParams, type StandardIssue } from "./contract-route.js";

const SCHEMA_INVALID_ROLE = "schemaInvalid";
const FORBIDDEN_ROLE = "forbidden";
const FALLBACK_RULE = "invalid";

// The validator input's parts, as an issue's `in` names them (ADR 0006 section 6).
const ISSUE_PARTS: Readonly<Record<string, string>> = {
  path: "path",
  query: "query",
  headers: "header",
  body: "body",
};

/** One `schemaInvalid` issue: the input part, the pointer inside it and the contract's rule name. */
export interface InputIssue {
  readonly in: string;
  readonly pointer: string;
  readonly rule: string;
}

/** Step 6: the validated input `{ path, query, headers, body }`, or a 400 with every issue. */
export async function validateRequestInput(state: CheckState): Promise<unknown> {
  const { route, request } = state;
  const params = decodeRequestParams(route, request, state.pathParams);
  const candidate = route.input === undefined ? params : { ...params, body: request.body };
  const result = await route.validator["~standard"].validate(candidate);

  if (result.issues === undefined) return withDefaultLimit(route, result.value);

  const issues = inputIssues(candidate, result.issues);

  throw roleError(route, SCHEMA_INVALID_ROLE, { issues: issues.slice(0, MAX_RENDERED_ISSUES) });
}

// The paging limit the client did not send is the contract's default, as the handler receives it.
function withDefaultLimit(route: ContractRoute, input: unknown): unknown {
  const paging = route.paging;

  if (paging?.limitParam === undefined || paging.defaultLimit === undefined) return input;

  if (!isPlainObject(input) || !isPlainObject(input.query)) return input;

  if (input.query[paging.limitParam] !== undefined) return input;

  return { ...input, query: { ...input.query, [paging.limitParam]: paging.defaultLimit } };
}

// The validator's issues named by the contract's rules (`minLength`, `required`, ...), never the validator's codes.
function inputIssues(candidate: unknown, issues: readonly StandardIssue[]): InputIssue[] {
  return issues.flatMap((issue) => {
    const keys = (issue.path ?? []).map((segment) =>
      typeof segment === "object" ? String(segment.key) : String(segment),
    );
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

  return {
    in: ISSUE_PARTS[part] ?? part,
    pointer: inside.map((key) => `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`).join(""),
    rule,
  };
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
      return "enum";
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

/** Step 7: a restricted input field sent without its right is refused with its pointer, or stripped. */
export async function checkRestrictedInput(
  state: CheckState,
  grant: AccessGrant,
  input: unknown,
): Promise<unknown> {
  const inputRights = state.route.fieldRights.filter(
    (fieldRight) => fieldRight.direction === "input",
  );

  if (inputRights.length === 0 || !isPlainObject(input) || !isPlainObject(input.body)) return input;

  const body: Record<string, unknown> = { ...input.body };

  for (const fieldRight of inputRights) {
    const member = topLevelMember(fieldRight.pointer);

    if (!Object.hasOwn(body, member)) continue;

    const denial = await decide(state, grant, {
      kind: "right",
      name: fieldRight.right,
      params: fieldRight.params,
      subject: fieldRight.subject,
      errors: fieldRight.errors,
      purpose: { kind: "field", pointer: fieldRight.pointer, direction: "input" },
    });

    if (denial === undefined) continue;

    // A decider failure is a 500 reported to the hook, never a denial to strip or to render with the pointer.
    if (denial.unexpectedCause !== undefined) throw denial;

    if (fieldRight.inputPolicy === "strip") {
      delete body[member];
      continue;
    }

    throw new ContractError(denial.code, forbiddenParams(state.route, denial, fieldRight.pointer));
  }

  return { ...input, body };
}

/** The member a top-level pointer such as `/effort` names. */
export function topLevelMember(pointer: string): string {
  return pointer.slice(1).replaceAll("~1", "/").replaceAll("~0", "~");
}

// The decider's params, with the restricted field's pointer when the code binds the `forbidden` role's data.
function forbiddenParams(route: ContractRoute, denial: ContractError, pointer: string): unknown {
  const entry = Object.hasOwn(route.errors, denial.code) ? route.errors[denial.code] : undefined;
  const rendered = entry === undefined ? undefined : roleParams(entry, FORBIDDEN_ROLE, { pointer });

  if (!isPlainObject(rendered)) return denial.params;

  return { ...(isPlainObject(denial.params) ? denial.params : {}), ...rendered };
}
