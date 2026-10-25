import {
  AS_ERROR_SOURCE,
  operationType,
  propertyKey,
  type QueryOperation,
  type QueryPlan,
  type Refusal,
  typeScriptIdentifier,
} from "@seampact/codegen-core";
import { deriveName, splitName } from "@seampact/spec/naming";
import {
  ACTION_KEY_RUNTIME_IMPORT,
  ACTION_KEY_SOURCE,
  actionKeyOf,
  callOptionsType,
  callParameterSource,
  LATEST_READ_SOURCE,
  NAME_ROLE,
  OUTCOME_SOURCE,
  readKeyExpression,
  writeSendSource,
} from "./call-flows.js";

// The `ngrx.ts` of one api for `state: ngrx` (ADR 0021 "Angular"): per resource an NgRx action group, with per
// operation the action that asks for the call, its success with the data and its failure with the error; per operation
// a functional effect that sends the call through the `<Api>Api` service and dispatches the outcome; and
// `provide<Api>Effects()`. A read is aborted by the next read of the same request and ends in its failure; reads of
// other requests run side by side. Writes all run (`mergeMap`), each with its own idempotency key unless the action
// gives one. Reducers, selectors and the state shape stay the app's.

export const NGRX_MODULE = "ngrx";

const ACTIONS_SUFFIX = "Actions";

/** The action group of one resource, or of the api's operations that have none. */
interface ActionGroup {
  readonly name: string;
  readonly source: string;
  readonly operations: readonly QueryOperation[];
}

/** The specifiers `ngrx.ts` imports the service, the queries module and the runtime from. */
export interface NgrxImports {
  readonly service: string;
  readonly queries: string;
  readonly runtime: string;
}

/**
 * A refusal per action group that would take the name of another, as two resources spelt apart can, and per event
 * name taken twice in one group, as an operation named after another's success or failure.
 */
export function refuseActionGroupCollisions(plan: QueryPlan): Refusal[] {
  const groups = actionGroupsOf(plan);
  const seen = new Set<string>();
  const refusals: Refusal[] = groups.flatMap(refuseEventCollisions);

  for (const group of groups) {
    if (!seen.has(group.name)) {
      seen.add(group.name);
      continue;
    }

    refusals.push({
      code: "names.collision",
      message: `Two action groups of the api would be named '${group.name}', one of them for '${group.source}'.`,
      fix: "Rename the resource in the contract, or drop 'state'.",
      ...locatedOn(group.operations[0]),
    });
  }

  return refusals;
}

function refuseEventCollisions(group: ActionGroup): Refusal[] {
  const seen = new Set<string>();
  const refusals: Refusal[] = [];

  for (const operation of group.operations) {
    const taken = eventNamesOf(operation).filter((name) => seen.has(name));

    for (const name of eventNamesOf(operation)) seen.add(name);

    if (taken.length === 0) continue;

    refusals.push({
      code: "names.collision",
      message: `The operation '${operation.operationId}' would add the action '${taken.join("', '")}' to '${group.name}', which another operation of '${group.source}' already has.`,
      fix: "Rename the operation in the contract, or drop 'state'.",
      ...locatedOn(operation),
    });
  }

  return refusals;
}

function locatedOn(operation: QueryOperation | undefined): Pick<Refusal, "member" | "operation"> {
  if (operation === undefined) return { member: "" };

  return { member: "", operation: operation.operationId };
}

// The call, its success and its failure, in that order.
function eventNamesOf(operation: QueryOperation): readonly string[] {
  const base = operation.names.base;

  return [base, `${base}Success`, `${base}Failure`];
}

/** The source of `ngrx.ts`. */
export function ngrxModuleSource(plan: QueryPlan, imports: NgrxImports): string {
  const api = plan.apiName;
  const groups = actionGroupsOf(plan);
  const writes = plan.operations.some((operation) => operation.form === "mutation");
  const reads = plan.operations.some((operation) => operation.form === "query");
  const keyedWrites = plan.operations.some((operation) => actionKeyOf(operation) !== undefined);
  const rxjsNames = [
    ...(reads ? ["defer", "filter", "finalize", "groupBy"] : []),
    ...(reads || writes ? ["mergeMap"] : []),
    "NEVER",
    "Observable",
    ...(reads ? ["type OperatorFunction", "Subject", "take"] : []),
  ];
  const runtimeNames = [
    ...(reads ? ["keyRequest"] : []),
    ...(keyedWrites ? [ACTION_KEY_RUNTIME_IMPORT] : []),
  ];
  const effects = groups.flatMap((group) =>
    group.operations.map((operation) => effectSource(operation, group.name, api)),
  );

  return [
    [
      `import { type EnvironmentProviders, inject } from "@angular/core";`,
      `import { Actions, createEffect, ofType, provideEffects } from "@ngrx/effects";`,
      `import { createActionGroup, props } from "@ngrx/store";`,
      `import { ${rxjsNames.join(", ")} } from "rxjs";`,
      `import type { ${api}Operations } from "${imports.queries}";`,
      ...(runtimeNames.length === 0
        ? []
        : [`import { ${runtimeNames.join(", ")} } from "${imports.runtime}";`]),
      `import { ${api}Api } from "${imports.service}";`,
    ].join("\n"),
    AS_ERROR_SOURCE,
    OUTCOME_SOURCE,
    ...(reads ? [LATEST_READ_SOURCE] : []),
    ...(keyedWrites ? [ACTION_KEY_SOURCE] : []),
    ...groups.map((group) => actionGroupSource(group, api)),
    `/** Per operation, the effect that sends the call its action asks for and dispatches its success or failure. */
export const ${api}Effects = {
${effects.join(",\n\n")},
};`,
    `/** The effects of \`${api}Effects\`, to list in the app's providers beside \`provideStore()\` and \`provide${api}Api()\`. */
export function provide${api}Effects(): EnvironmentProviders {
return provideEffects(${api}Effects);
}`,
  ].join("\n\n");
}

// One group per resource, sorted, then one for the operations with no resource, named by the api.
function actionGroupsOf(plan: QueryPlan): ActionGroup[] {
  const api = plan.apiName;
  const resourceGroups = plan.resources.map((resource) => ({
    name: `${typeScriptIdentifier(deriveName(splitName(resource), NAME_ROLE))}${ACTIONS_SUFFIX}`,
    source: `${api}/${resource}`,
    operations: plan.operations.filter((operation) => operation.resource === resource),
  }));
  const withoutResource = plan.operations.filter((operation) => operation.resource === undefined);

  return [
    ...resourceGroups,
    ...(withoutResource.length === 0
      ? []
      : [{ name: `${api}Api${ACTIONS_SUFFIX}`, source: api, operations: withoutResource }]),
  ];
}

function actionGroupSource(group: ActionGroup, api: string): string {
  const events = group.operations.map((operation) => {
    const types = operationType(operation, api);
    const base = operation.names.base;
    const callType = callOptionsType(operation, api);
    const call = callParameterSource(operation, callType);

    return [
      `${propertyKey(base)}: props<{ request: ${types}["request"]; ${call} }>(),`,
      `${propertyKey(`${base}Success`)}: props<{ request: ${types}["request"]; data: ${types}["data"] }>(),`,
      `${propertyKey(`${base}Failure`)}: props<{ request: ${types}["request"]; error: ${types}["error"] }>(),`,
    ].join("\n");
  });

  return `/** The actions of ${JSON.stringify(group.source)}: per operation the call to send, its success with the data and its failure with the error. */
export const ${group.name} = createActionGroup({
source: ${JSON.stringify(group.source)},
events: {
${events.join("\n")}
},
});`;
}

function effectSource(operation: QueryOperation, group: string, api: string): string {
  const base = operation.names.base;
  const outcomes = `(data) => ${group}.${base}Success({ request: action.request, data }),
(error) => ${group}.${base}Failure({ request: action.request, error }),`;
  const flow =
    operation.form === "query"
      ? readFlowSource(operation, outcomes)
      : writeFlowSource(operation, api, outcomes);

  return `${propertyKey(base)}: createEffect(
(actions = inject(Actions), api = inject(${api}Api)) =>
actions.pipe(
ofType(${group}.${base}),
${flow},
),
{ functional: true },
)`;
}

// A read sends through the service's query fetcher, aborted by the next read of the same request.
function readFlowSource(operation: QueryOperation, outcomes: string): string {
  return `latestReadPerRequest(
(action) => ${readKeyExpression(operation, "action.request")},
(action, superseded) =>
outcomeOf(
(signal) => api.queries.${operation.names.options}(action.request, action.call).fetcher(signal),
${outcomes}
superseded,
),
)`;
}

// A write sends with the action as the attempt, so each action sends one idempotency key, or the key the action gives.
function writeFlowSource(operation: QueryOperation, api: string, outcomes: string): string {
  const send = writeSendSource(operation, api, {
    parameters: "",
    request: "action.request",
    call: "action.call",
    attempt: "action",
  });

  return `mergeMap((action) =>
outcomeOf(
${send},
${outcomes}
),
)`;
}
