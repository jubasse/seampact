import { operationType, type QueryOperation } from "@seampact/codegen-core";

// The call flows `state: ngrx` and `state: ngrx-signals` share (ADR 0021 "Angular"): one call as an observable of its
// success or failure, the latest read per request key, the request key of a read, and a write that sends the
// idempotency key its caller gives.

export const OUTCOME_SOURCE = `// The success or failure of one call; an error never leaves the stream. A call \`superseded\` aborts ends in its
// failure with the abort error; unsubscribing, as an effect's or a store's teardown does, aborts it with no outcome.
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

export const LATEST_READ_SOURCE = `// Per request key, the latest read wins: a read of the same request aborts the one still waiting, which ends in its
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

/** The rxjs names `LATEST_READ_SOURCE` and `OUTCOME_SOURCE` need. */
export const LATEST_READ_RXJS_NAMES = [
  "defer",
  "filter",
  "finalize",
  "groupBy",
  "mergeMap",
  "NEVER",
  "Observable",
  "type OperatorFunction",
  "Subject",
  "take",
];

export const ACTION_KEY_SOURCE = `// The request with the idempotency key a write action gives; without one, the service draws a key per action.
function withActionKey<Request extends object | undefined>(
request: Request,
headerKey: string,
idempotencyKey: string | undefined,
): Request {
if (idempotencyKey === undefined) return request;

return withIdempotencyKey(request, headerKey, () => idempotencyKey);
}`;

export const ACTION_KEY_TYPE = "{ readonly idempotencyKey?: string }";

// The idempotency header of a write whose caller may give its own key.
export function actionKeyOf(operation: QueryOperation): string | undefined {
  return operation.form === "mutation" ? operation.idempotencyHeaderKey : undefined;
}

/** The type of a call's `call` member: the client's call options, with the idempotency key a keyed write takes. */
export function callOptionsType(operation: QueryOperation, api: string): string {
  const actionKey = actionKeyOf(operation) === undefined ? "" : ` & ${ACTION_KEY_TYPE}`;

  return `${operationType(operation, api)}["call"]${actionKey}`;
}

/** The request key a read is grouped by, as an expression over `request`. */
export function readKeyExpression(operation: QueryOperation, request: string): string {
  return `JSON.stringify(keyRequest(${request}, ${JSON.stringify(operation.filledHeaderKeys)})) ?? ""`;
}

/** The parameters of a write's send, and the expressions it reads its request, call options and attempt from. */
export interface WriteSendNames {
  readonly parameters: string;
  readonly request: string;
  readonly call: string;
  readonly attempt: string;
}

/**
 * A write's send, a function of `names.parameters`, through the service's mutation fetcher with the attempt, so each
 * attempt sends one idempotency key, or the key its call options give.
 */
export function writeSendSource(
  operation: QueryOperation,
  api: string,
  names: WriteSendNames,
): string {
  const options = operation.names.options;
  const headerKey = actionKeyOf(operation);
  const callFallback = operation.needsTimeout ? "" : " ?? {}";

  if (headerKey === undefined) {
    return `(${names.parameters}) => api.queries.${options}(${names.call}).fetcher(${names.request}, ${names.attempt})`;
  }

  return `(${names.parameters}) => {
const { idempotencyKey, ...call }: ${callOptionsType(operation, api)} = ${names.call}${callFallback};

return api.queries
.${options}(call)
.fetcher(withActionKey(${names.request}, ${JSON.stringify(headerKey)}, idempotencyKey), ${names.attempt});
}`;
}
