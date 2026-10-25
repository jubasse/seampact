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

// The `ngrx.ts` of one api for `state: ngrx` (ADR 0021 "Angular"): per resource an NgRx action group, with per
// operation the action that asks for the call, its success with the data and its failure with the error; per operation
// a functional effect that sends the call through the `<Api>Api` service and dispatches the outcome; and
// `provide<Api>Effects()`. A read is aborted by the next read of the same request and ends in its failure; reads of
// other requests run side by side. Writes all run (`mergeMap`), each with its own idempotency key unless the action
// gives one. Reducers, selectors and the state shape stay the app's.

export const NGRX_MODULE = "ngrx";

const ACTIONS_SUFFIX = "Actions";
const NAME_ROLE = "schema";

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

const OUTCOME_SOURCE = `// The success or failure action of one call; an error never leaves the effect. A call \`superseded\` aborts ends in
// its failure with the abort error; unsubscribing, as the effect's teardown does, aborts it with no outcome.
function outcomeOf<Data, Succeeded, Failed>(
send: (signal: AbortSignal) => Promise<Data>,
succeeded: (data: Data) => Succeeded,
failed: (error: Error) => Failed,
superseded: Observable<unknown> = NEVER,
): Observable<Succeeded | Failed> {
return new Observable<Succeeded | Failed>((subscriber) => {
const controller = new AbortController();
let settled = false;

subscriber.add(superseded.subscribe(() => controller.abort()));

void new Promise<Data>((resolve) => {
resolve(send(controller.signal));
}).then(
(data) => {
settled = true;
subscriber.next(succeeded(data));
subscriber.complete();
},
(rejection: unknown) => {
settled = true;
subscriber.next(failed(asError(rejection)));
subscriber.complete();
},
);

return () => {
if (!settled) controller.abort();
};
});
}`;

const LATEST_READ_SOURCE = `// Per request key, the latest read wins: a read of the same request aborts the one still waiting, which ends in its
// failure; reads of other requests run side by side. A request's group closes once none of its reads waits.
function latestReadPerRequest<Action, Outcome>(
keyOf: (action: Action) => string,
read: (action: Action, superseded: Observable<Action>) => Observable<Outcome>,
): OperatorFunction<Action, Outcome> {
return (actions) =>
defer(() => {
const idleKeys = new Subject<string>();

return actions.pipe(
groupBy(keyOf, {
duration: (group) => idleKeys.pipe(filter((idleKey) => idleKey === group.key)),
}),
mergeMap((group) => {
let waiting = 0;

return group.pipe(
mergeMap((action) => {
waiting += 1;

return read(action, group.pipe(take(1))).pipe(
finalize(() => {
waiting -= 1;
if (waiting === 0) idleKeys.next(group.key);
}),
);
}),
);
}),
);
});
}`;

const ACTION_KEY_SOURCE = `// The request with the idempotency key a write action gives; without one, the service draws a key per action.
function withActionKey<Request extends object | undefined>(
request: Request,
headerKey: string,
idempotencyKey: string | undefined,
): Request {
if (idempotencyKey === undefined) return request;

return withIdempotencyKey(request, headerKey, () => idempotencyKey);
}`;

const ACTION_KEY_TYPE = "{ readonly idempotencyKey?: string }";

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
    ...(keyedWrites ? ["withIdempotencyKey"] : []),
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
    const actionKey = actionKeyOf(operation) === undefined ? "" : ` & ${ACTION_KEY_TYPE}`;
    const callType = `${types}["call"]${actionKey}`;
    const call = operation.needsTimeout ? `call: ${callType}` : `call?: ${callType}`;

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

// The idempotency header of a write whose action may give its own key.
function actionKeyOf(operation: QueryOperation): string | undefined {
  return operation.form === "mutation" ? operation.idempotencyHeaderKey : undefined;
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
  const filled = JSON.stringify(operation.filledHeaderKeys);

  return `latestReadPerRequest(
(action) => JSON.stringify(keyRequest(action.request, ${filled})) ?? "",
(action, superseded) =>
outcomeOf(
(signal) => api.queries.${operation.names.options}(action.request, action.call).fetcher(signal),
${outcomes}
superseded,
),
)`;
}

// A write sends through the service's mutation fetcher with the action as the attempt, so each action sends one
// idempotency key, or the key the action gives.
function writeFlowSource(operation: QueryOperation, api: string, outcomes: string): string {
  const options = operation.names.options;
  const headerKey = actionKeyOf(operation);
  const callFallback = operation.needsTimeout ? "" : " ?? {}";
  const send =
    headerKey === undefined
      ? `() => api.queries.${options}(action.call).fetcher(action.request, action)`
      : `() => {
const { idempotencyKey, ...call }: ${operationType(operation, api)}["call"] & ${ACTION_KEY_TYPE} = action.call${callFallback};

return api.queries
.${options}(call)
.fetcher(withActionKey(action.request, ${JSON.stringify(headerKey)}, idempotencyKey), action);
}`;

  return `mergeMap((action) =>
outcomeOf(
${send},
${outcomes}
),
)`;
}
