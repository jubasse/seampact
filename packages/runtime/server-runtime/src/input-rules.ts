// App input rules on the Node servers (ADR 0028): the `inputRules` registration entry, its boot check, and step 8b, which runs the rules of an operation's parts after the idempotency claim and before the handler.
import type { CheckState } from "./access-checks.js";
import type { BoundaryContext } from "./boundary-context.js";
import type { BootProblem } from "./boundary-hooks.js";
import { unexpectedError } from "./contract-error.js";
import type { ContractApi, ContractRoute } from "./contract-route.js";
import { abandonIdempotencyClaim } from "./idempotency.js";
import {
  type InputIssue,
  ISSUE_PARTS,
  type RequestPart,
  schemaInvalidError,
} from "./input-issues.js";
import {
  type ApiInputRuleAdapter,
  type InputRuleAdapter,
  inputRuleAdapterOf,
} from "./input-rule-libraries.js";
import { isPlainObject } from "./plain-object.js";
import { runtimeLog } from "./runtime-logger.js";

/** The parts a rule set names, in the order their rules run. */
export const INPUT_RULE_PARTS: readonly RequestPart[] = ["path", "query", "headers", "body"];

/** The rules of one api, by operation id then part; the generated `InputRules` type narrows it. */
export type InputRuleSets = Readonly<
  Record<string, Readonly<Partial<Record<RequestPart, unknown>>> | undefined>
>;

const APP_RULE_PREFIX = "app.";
const UNNAMED_RULE = "invalid";
const RULE_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The operation ids a fix lists for a misspelt one, so a large api keeps the message short.
const LISTED_OPERATION_IDS = 10;

// The rules already logged for a missing name, so each is logged once.
const loggedUnnamedRules = new Set<string>();

/** Every problem of the `inputRules` entry, listed with the other registration problems at boot. */
export function inputRulesProblems(api: ContractApi, inputRules: unknown): BootProblem[] {
  if (inputRules === undefined) return [];

  if (!isPlainObject(inputRules)) {
    return [
      {
        problem: "'inputRules' is not an object",
        fix: "pass 'inputRules' as an object keyed by operation id, or leave it out",
      },
    ];
  }

  const adapter = inputRuleAdapterOf(api);
  const problems: BootProblem[] = [];

  for (const [operationId, ruleSet] of Object.entries(inputRules)) {
    const route = api.routes.find((candidate) => candidate.id === operationId);

    if (route === undefined) {
      problems.push({
        problem: `'inputRules' names '${operationId}', which is no operation of the api or one its entry's 'operations' filter drops`,
        fix: `use one of ${operationIdList(api)}`,
      });

      continue;
    }

    problems.push(...ruleSetProblems(route, adapter, ruleSet));
  }

  return problems;
}

function operationIdList(api: ContractApi): string {
  const ids = api.routes.map((each) => each.id);
  const listed = ids.slice(0, LISTED_OPERATION_IDS).join(", ");

  return ids.length > LISTED_OPERATION_IDS
    ? `${listed}, or one of the ${ids.length - LISTED_OPERATION_IDS} others`
    : listed;
}

function ruleSetProblems(
  route: ContractRoute,
  { adapter, unusable }: ApiInputRuleAdapter,
  ruleSet: unknown,
): BootProblem[] {
  if (route.relays !== undefined) {
    return [
      {
        operation: route.id,
        problem: `'inputRules' names the relay of '${route.relays}', which takes no rules`,
        fix: `write the rules in the gateway's own registration of '${route.relays}', and remove these`,
      },
    ];
  }

  if (!isPlainObject(ruleSet)) {
    return [
      {
        operation: route.id,
        problem: "its 'inputRules' entry is not an object",
        fix: "key its rules by part: 'path', 'query', 'headers' or 'body'",
      },
    ];
  }

  if (adapter === undefined) {
    return [
      {
        operation: route.id,
        problem: "its input rules cannot run on the api's generated validators",
        fix: unusable,
      },
    ];
  }

  return Object.entries(ruleSet).flatMap(([part, rule]) =>
    partProblems(route, adapter, part, rule),
  );
}

function partProblems(
  route: ContractRoute,
  adapter: InputRuleAdapter,
  part: string,
  rule: unknown,
): BootProblem[] {
  if (!isRequestPart(part)) {
    return [
      {
        operation: route.id,
        problem: `its 'inputRules' entry names the part '${part}'`,
        fix: "key its rules by part: 'path', 'query', 'headers' or 'body'",
      },
    ];
  }

  if (!hasInputIn(route, part)) {
    return [
      {
        operation: route.id,
        problem: `its 'inputRules' entry has rules for '${part}', where the operation takes no input`,
        fix: `remove the '${part}' rules, or declare that input in the contract`,
      },
    ];
  }

  if (!adapter.accepts(rule)) {
    return [
      {
        operation: route.id,
        problem: `its '${part}' rules are not ${adapter.expected}`,
        fix: `pass ${adapter.expected}, the library the api's validators are generated with`,
      },
    ];
  }

  return [];
}

/**
 * Step 8b: runs the operation's rules, each on a copy of its part as the handler receives it. A refusal releases the
 * idempotency claim and answers the `schemaInvalid` role with every issue named `app.<name>`; a rule that throws is
 * a 500 that never carries its message.
 */
export async function runInputRules(
  state: CheckState,
  context: BoundaryContext,
  inputRules: unknown,
): Promise<void> {
  const route = context.route;
  const ruleSet = isPlainObject(inputRules) ? inputRules[route.id] : undefined;

  if (!isPlainObject(ruleSet)) return;

  // The registration's boot check refuses rules no adapter runs, so this guards a call without it.
  const { adapter, unusable } = inputRuleAdapterOf(state.api);

  if (adapter === undefined) {
    throw unexpectedError(
      route,
      new Error(`seampact: '${route.id}' has input rules that cannot run. Fix: ${unusable}`),
    );
  }

  const issues: InputIssue[] = [];

  for (const part of INPUT_RULE_PARTS) {
    const rule = ruleSet[part];

    if (rule === undefined) continue;

    issues.push(
      ...(await partIssues(
        state.api,
        route,
        adapter,
        part,
        rule,
        partValue(route, context.input, part),
      )),
    );
  }

  if (issues.length === 0) return;

  await abandonIdempotencyClaim(context);

  throw schemaInvalidError(route, issues);
}

async function partIssues(
  api: ContractApi,
  route: ContractRoute,
  adapter: InputRuleAdapter,
  part: RequestPart,
  rule: unknown,
  value: unknown,
): Promise<InputIssue[]> {
  try {
    const refusals = await adapter.refusals(rule, structuredClone(value));

    return refusals.map((refusal) => ({
      in: ISSUE_PARTS[part],
      pointer: refusal.pointer,
      rule: `${APP_RULE_PREFIX}${usableName(api, route, part, adapter, refusal.name)}`,
    }));
  } catch (error) {
    throw unexpectedError(
      route,
      new Error(`seampact: an app input rule of '${route.id}' on its ${part} threw`, {
        cause: error,
      }),
    );
  }
}

// The rule's name, or `invalid` with the fix logged once per rule when the library gave no usable one.
function usableName(
  api: ContractApi,
  route: ContractRoute,
  part: RequestPart,
  adapter: InputRuleAdapter,
  name: unknown,
): string {
  if (typeof name === "string" && RULE_NAME.test(name) && !UUID_SHAPED.test(name)) return name;

  const ruleKey = `${api.id} ${route.id} ${part} ${String(name)}`;

  if (!loggedUnnamedRules.has(ruleKey)) {
    loggedUnnamedRules.add(ruleKey);
    runtimeLog.warn(
      `seampact: an app input rule of '${route.id}' on its ${part} reports no usable name (${JSON.stringify(name) ?? "none"}), so its issue is 'app.${UNNAMED_RULE}'. Fix: ${adapter.namingFix}; a name matches ${RULE_NAME.source} and is not a UUID.`,
    );
  }

  return UNNAMED_RULE;
}

// The part as the handler receives it, without the body proof fields steps 4 and 5 read.
function partValue(route: ContractRoute, input: unknown, part: RequestPart): unknown {
  const value = isPlainObject(input) ? input[part] : undefined;

  if (part !== "body" || !isPlainObject(value)) return value;

  const proofFields = new Set(route.requires.flatMap((requirement) => requirement.proof ?? []));

  return Object.fromEntries(Object.entries(value).filter(([member]) => !proofFields.has(member)));
}

function hasInputIn(route: ContractRoute, part: RequestPart): boolean {
  if (part === "body") return route.input !== undefined;

  return route.params[part].length > 0;
}

function isRequestPart(part: string): part is RequestPart {
  return INPUT_RULE_PARTS.some((each) => each === part);
}
