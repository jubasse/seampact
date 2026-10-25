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
// `provide<Api>Effects()`. A read is cancelled by the next read of the same operation (`switchMap`), a write never
// (`mergeMap`, each with its own idempotency key). Reducers, selectors and the state shape stay the app's.

export const NGRX_MODULE = "ngrx";

const ACTIONS_SUFFIX = "Actions";
const NAME_ROLE = "schema";

/** The action group of one resource, or of the api's operations that have none. */
interface ActionGroup {
  readonly name: string;
  readonly source: string;
  readonly operations: readonly QueryOperation[];
}

/** The specifiers `ngrx.ts` imports the service and the queries module from. */
export interface NgrxImports {
  readonly service: string;
  readonly queries: string;
}

const OUTCOME_SOURCE = `// The success or failure action of one call; an error never leaves the effect. Unsubscribing, as \`switchMap\` does
// on the next read, aborts the call and drops its outcome.
function outcomeOf<Data, Succeeded, Failed>(
send: (signal: AbortSignal) => Promise<Data>,
succeeded: (data: Data) => Succeeded,
failed: (error: Error) => Failed,
): Observable<Succeeded | Failed> {
return new Observable<Succeeded | Failed>((subscriber) => {
const controller = new AbortController();
let settled = false;

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

/** A refusal per action group that would take the name of another, as two resources spelt apart can. */
export function refuseActionGroupCollisions(plan: QueryPlan): Refusal[] {
  const groups = actionGroupsOf(plan);
  const seen = new Set<string>();
  const refusals: Refusal[] = [];

  for (const group of groups) {
    if (!seen.has(group.name)) {
      seen.add(group.name);
      continue;
    }

    refusals.push({
      code: "names.collision",
      message: `Two action groups of the api would be named '${group.name}', one of them for '${group.source}'.`,
      fix: "Rename the resource in the contract, or drop 'state'.",
      member: "",
    });
  }

  return refusals;
}

/** The source of `ngrx.ts`. */
export function ngrxModuleSource(plan: QueryPlan, imports: NgrxImports): string {
  const api = plan.apiName;
  const groups = actionGroupsOf(plan);
  const writes = plan.operations.some((operation) => operation.form === "mutation");
  const reads = plan.operations.some((operation) => operation.form === "query");
  const rxjsNames = [
    ...(writes ? ["mergeMap"] : []),
    "Observable",
    ...(reads ? ["switchMap"] : []),
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
      `import { ${api}Api } from "${imports.service}";`,
    ].join("\n"),
    AS_ERROR_SOURCE,
    OUTCOME_SOURCE,
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
    const call = operation.needsTimeout ? `call: ${types}["call"]` : `call?: ${types}["call"]`;

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

// A read sends through the service's query fetcher, aborted by the next read; a write through its mutation fetcher,
// with the action as the attempt, so each action sends one idempotency key.
function effectSource(operation: QueryOperation, group: string, api: string): string {
  const base = operation.names.base;
  const options = operation.names.options;
  const isRead = operation.form === "query";
  const flatten = isRead ? "switchMap" : "mergeMap";
  const send = isRead
    ? `(signal) => api.queries.${options}(action.request, action.call).fetcher(signal)`
    : `() => api.queries.${options}(action.call).fetcher(action.request, action)`;

  return `${propertyKey(base)}: createEffect(
(actions = inject(Actions), api = inject(${api}Api)) =>
actions.pipe(
ofType(${group}.${base}),
${flatten}((action) =>
outcomeOf(
${send},
(data) => ${group}.${base}Success({ request: action.request, data }),
(error) => ${group}.${base}Failure({ request: action.request, error }),
),
),
),
{ functional: true },
)`;
}
