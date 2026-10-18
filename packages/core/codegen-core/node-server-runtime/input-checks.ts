// Steps 6 and 7 of the check order (ADR 0012): the whole request validated in one pass by the validators link,
// then restricted input fields. Copied into the generated tree as is.
import { type AccessGrant, type CheckState, decide } from "./access-checks.js";
import { ContractError, codeOfRole, isPlainObject, MAX_RENDERED_ISSUES } from "./contract-error.js";
import { decodeRequestParams, type StandardIssue } from "./contract-route.js";

const SCHEMA_INVALID_ROLE = "schemaInvalid";
const FALLBACK_RULE = "invalid";

/** Step 6: the validated input `{ path, query, headers, body }`, or a 400 with every issue. */
export async function validateRequestInput(state: CheckState): Promise<unknown> {
  const { route, request } = state;
  const params = decodeRequestParams(route, request, state.pathParams);
  const candidate = route.input === undefined ? params : { ...params, body: request.body };
  const result = await route.validator["~standard"].validate(candidate);

  if (result.issues === undefined) return result.value;

  const code = codeOfRole(route, SCHEMA_INVALID_ROLE);

  if (code === undefined) {
    throw new ContractError(
      "api.internal",
      undefined,
      new Error(`operation '${route.id}' declares no schemaInvalid code`),
    );
  }

  throw new ContractError(code, {
    issues: result.issues.slice(0, MAX_RENDERED_ISSUES).map(renderedIssue),
  });
}

function renderedIssue(issue: StandardIssue): { pointer: string; rule: string } {
  const keys = (issue.path ?? []).map((segment) =>
    typeof segment === "object" ? String(segment.key) : String(segment),
  );
  const pointer = keys.map((key) => `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
  const code: unknown = "code" in issue ? issue.code : undefined;

  return { pointer, rule: typeof code === "string" ? code : FALLBACK_RULE };
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

    throw new ContractError(denial.code, {
      ...(isPlainObject(denial.params) ? denial.params : {}),
      pointer: `/body${fieldRight.pointer}`,
    });
  }

  return { ...input, body };
}

/** The member a top-level pointer such as `/effort` names. */
export function topLevelMember(pointer: string): string {
  return pointer.slice(1).replaceAll("~1", "/").replaceAll("~0", "~");
}
