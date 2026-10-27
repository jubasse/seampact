// Steps 6 and 7 of the check order (ADR 0012): the whole request validated in one pass by the validators link,
// then restricted input fields.
import { type AccessGrant, type CheckState, decide } from "./access-checks.js";
import { ContractError, roleParams } from "./contract-error.js";
import type { ContractRoute } from "./contract-route.js";
import { schemaInvalidError, validateRequest } from "./input-issues.js";
import { isPlainObject } from "./plain-object.js";

const FORBIDDEN_ROLE = "forbidden";

/**
 * Step 6: the validated input `{ path, query, headers, body }`, or a 400 with every issue. The validation steps 4
 * and 5 recorded on the grant is reused, never run twice; without a grant (a refusal before the access steps) the
 * request is validated here.
 */
export async function validateRequestInput(
  state: CheckState,
  grant?: AccessGrant,
): Promise<unknown> {
  const validation = grant?.validation ?? (await validateRequest(state));

  if (validation.issues.length === 0) return withDefaultLimit(state.route, validation.value);

  throw schemaInvalidError(state.route, validation.issues);
}

// The paging limit the client did not send is the contract's default, as the handler receives it.
function withDefaultLimit(route: ContractRoute, input: unknown): unknown {
  const paging = route.paging;

  if (paging?.limitParam === undefined || paging.defaultLimit === undefined) return input;

  if (!isPlainObject(input) || !isPlainObject(input.query)) return input;

  if (input.query[paging.limitParam] !== undefined) return input;

  return { ...input, query: { ...input.query, [paging.limitParam]: paging.defaultLimit } };
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
