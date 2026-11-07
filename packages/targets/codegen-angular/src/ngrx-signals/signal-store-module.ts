import {
  AS_ERROR_SOURCE,
  operationType,
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
  LATEST_READ_RXJS_NAMES,
  LATEST_READ_SOURCE,
  NAME_ROLE,
  OUTCOME_SOURCE,
  readKeyExpression,
  writeSendSource,
} from "../ngrx/call-flows.js";

// The `ngrx-signals.ts` of one api for `state: ngrx-signals` (ADR 0021 "Angular"): per operation a Signal Store
// feature `with<Op>()` that the app composes into its own `signalStore`. It adds the state slice `<op>` (the status,
// request, data and typed error of the operation's latest call) and the method `send<Op>(request, call?)`, which sends
// through the `<Api>Api` service and resolves to the slice its call settled. Reads follow the latest per request key
// as `state: ngrx` does, and skip the server unless the feature is given a `transferId`, which reads there and hands
// the data to the browser; writes run side by side, each with its own idempotency key unless the call gives one. The
// store, and any state beyond the slices, stay the app's. The module's own top-level names never start with `with`
// and a capital, so no feature `with<Op>` takes one of them.

export const NGRX_SIGNALS_MODULE = "ngrx-signals";

const FEATURE_PREFIX = "with";
const METHOD_PREFIX = "send";

/** The specifiers `ngrx-signals.ts` imports the service, the queries module and the runtime from. */
export interface SignalStoreImports {
  readonly service: string;
  readonly queries: string;
  readonly runtime: string;
}

const SLICE_TYPES = `/**
 * The state slice of one operation: its latest call's request and status, with the data once it succeeded or the
 * error once it failed. \`idle\` before any call, \`pending\` while it waits.
 */
export type OperationSlice<Request, Data, Failure> =
| { readonly status: "idle"; readonly request: undefined; readonly data: undefined; readonly error: undefined }
| { readonly status: "pending"; readonly request: Request; readonly data: undefined; readonly error: undefined }
| { readonly status: "success"; readonly request: Request; readonly data: Data; readonly error: undefined }
| { readonly status: "error"; readonly request: Request; readonly data: undefined; readonly error: Failure };

/** The state slice of one operation, from its types. */
export type SliceOf<Operation extends { request: unknown; data: unknown; error: unknown }> = OperationSlice<
Operation["request"],
Operation["data"],
Operation["error"]
>;

const IDLE_SLICE = { status: "idle", request: undefined, data: undefined, error: undefined } as const;

function pendingSlice<Request>(request: Request): OperationSlice<Request, never, never> {
return { status: "pending", request, data: undefined, error: undefined };
}

function succeededSlice<Request, Data>(request: Request, data: Data): OperationSlice<Request, Data, never> {
return { status: "success", request, data, error: undefined };
}

function failedSlice<Request>(request: Request, error: Error): OperationSlice<Request, never, Error> {
return { status: "error", request, data: undefined, error };
}`;

// The NgRx Signals names the module imports, aliased so that no feature takes their name.
const NGRX_SIGNALS_IMPORT = `import { patchState, signalStoreFeature, withMethods as ngrxWithMethods, withState as ngrxWithState } from "@ngrx/signals";`;

const READ_SENDER_SOURCE = `/**
 * The options of a read feature: \`transferId\` reads during server rendering, which the feature skips by default, and
 * hands each request's data to the browser under that id, where the first read of the request takes it and sends nothing.
 */
export interface ReadFeatureOptions {
readonly transferId?: string;
}

interface WaitingRead<Request, Call, Data> {
readonly request: Request;
readonly call: Call;
readonly resolve: (slice: OperationSlice<Request, Data, Error>) => void;
}

// The send of a read feature: the latest read of a request aborts the one still waiting, which resolves to its
// failure; reads of other requests run side by side. Only the latest read writes the slice; each resolves to the slice
// it settled. On the server it reads nothing and resolves to the idle slice, unless given a \`transferId\`. When the
// store is destroyed, every waiting read is aborted and resolves to its failure, and the slice no longer changes.
function readSender<Request, Call, Data>(
keyOf: (request: Request) => string,
fetcher: (request: Request, call: Call, signal: AbortSignal) => Promise<Data>,
write: (slice: OperationSlice<Request, Data, Error>) => void,
options: ReadFeatureOptions,
): (request: Request, call: Call) => Promise<OperationSlice<Request, Data, Error>> {
const transferId = options.transferId;
const onServer = isPlatformServer(inject(PLATFORM_ID));
const transferState = inject(TransferState);
const readsHere = transferId !== undefined || !onServer;
const transferKeyOf = (request: Request) => makeStateKey<Data | undefined>(\`\${transferId}:\${keyOf(request)}\`);
const asked = new Subject<WaitingRead<Request, Call, Data>>();
const waiting = new Set<WaitingRead<Request, Call, Data>>();
let latest: WaitingRead<Request, Call, Data> | undefined;
let destroyed = false;

const settle = (read: WaitingRead<Request, Call, Data>, slice: OperationSlice<Request, Data, Error>) => {
waiting.delete(read);
if (onServer && transferId !== undefined && slice.status === "success") {
transferState.set(transferKeyOf(read.request), slice.data);
}
if (read === latest && !destroyed) write(slice);
read.resolve(slice);
};

// The data the server read for this request, taken once.
const takeTransferred = (request: Request): Data | undefined => {
if (onServer || transferId === undefined) return undefined;

const transferKey = transferKeyOf(request);
const data = transferState.get(transferKey, undefined);

transferState.remove(transferKey);

return data;
};

const subscription = asked
.pipe(
latestReadPerRequest(
(read) => keyOf(read.request),
(read, superseded) =>
outcomeOf(
(signal) => fetcher(read.request, read.call, signal),
(data) => ({ read, slice: succeededSlice(read.request, data) }),
(error) => ({ read, slice: failedSlice(read.request, error) }),
superseded,
),
),
)
.subscribe(({ read, slice }) => {
settle(read, slice);
});

inject(DestroyRef).onDestroy(() => {
destroyed = true;
subscription.unsubscribe();
for (const read of waiting) settle(read, failedSlice(read.request, abortError()));
});

return (request, call) => {
if (!readsHere) return Promise.resolve(IDLE_SLICE);

if (destroyed) return Promise.resolve(failedSlice(request, abortError()));

const transferred = takeTransferred(request);

if (transferred !== undefined) {
const slice = succeededSlice(request, transferred);

// The transferred data is the latest call: no read still waiting writes the slice after it.
latest = undefined;
write(slice);

return Promise.resolve(slice);
}

return new Promise((resolve) => {
const read = { request, call, resolve };

latest = read;
waiting.add(read);
write(pendingSlice(request));
asked.next(read);
});
};
}

function abortError(): Error {
return new DOMException("The store was destroyed.", "AbortError");
}`;

const WRITE_SENDER_SOURCE = `// The send of a write feature: writes run side by side and each resolves to the slice it settled; only the latest
// writes the slice. Each call is its own attempt, so it sends one idempotency key, or the key its call options give.
// Once the store is destroyed a write still sends, as \`mutate\` does, but the slice no longer changes.
function writeSender<Request, Call, Data>(
send: (request: Request, call: Call, attempt: object) => Promise<Data>,
write: (slice: OperationSlice<Request, Data, Error>) => void,
): (request: Request, call: Call) => Promise<OperationSlice<Request, Data, Error>> {
let latest: object | undefined;
let destroyed = false;

inject(DestroyRef).onDestroy(() => {
destroyed = true;
});

return async (request, call) => {
const attempt = {};

latest = attempt;
if (!destroyed) write(pendingSlice(request));

const slice = await new Promise<Data>((resolve) => {
resolve(send(request, call, attempt));
}).then(
(data): OperationSlice<Request, Data, Error> => succeededSlice(request, data),
(rejection: unknown) => failedSlice(request, asError(rejection)),
);

if (latest === attempt && !destroyed) write(slice);

return slice;
};
}`;

/** The state member and the method one operation's feature adds to the app's store. */
function storeMembersOf(operation: QueryOperation): readonly string[] {
  return [operation.names.base, methodName(operation)];
}

/**
 * A refusal per operation whose state member or method takes a name another operation's feature adds, as an operation
 * named `sendTask` beside `task` would, since the app composes the features into one store.
 */
export function refuseStoreMemberCollisions(plan: QueryPlan): Refusal[] {
  const seen = new Set<string>();
  const refusals: Refusal[] = [];

  for (const operation of plan.operations) {
    const taken = storeMembersOf(operation).filter((name) => seen.has(name));

    for (const name of storeMembersOf(operation)) seen.add(name);

    if (taken.length === 0) continue;

    refusals.push({
      code: "names.collision",
      message: `The operation '${operation.operationId}' would add the store member '${taken.join("', '")}', which another operation's feature already adds.`,
      fix: "Rename the operation in the contract, or drop 'state'.",
      member: "",
      operation: operation.operationId,
    });
  }

  return refusals;
}

/** The source of `ngrx-signals.ts`. */
export function signalStoreModuleSource(plan: QueryPlan, imports: SignalStoreImports): string {
  const api = plan.apiName;
  const reads = plan.operations.some((operation) => operation.form === "query");
  const writes = plan.operations.some((operation) => operation.form === "mutation");
  const keyedWrites = plan.operations.some((operation) => actionKeyOf(operation) !== undefined);
  const angularNames = [
    "DestroyRef",
    "inject",
    ...(reads ? ["makeStateKey", "PLATFORM_ID", "TransferState"] : []),
  ];
  const runtimeNames = [
    ...(reads ? ["keyRequest"] : []),
    ...(keyedWrites ? [ACTION_KEY_RUNTIME_IMPORT] : []),
  ];
  const features = plan.operations.map((operation) => featureSource(operation, api));

  return [
    [
      ...(reads ? [`import { isPlatformServer } from "@angular/common";`] : []),
      `import { ${angularNames.join(", ")} } from "@angular/core";`,
      NGRX_SIGNALS_IMPORT,
      ...(reads ? [`import { ${LATEST_READ_RXJS_NAMES.join(", ")} } from "rxjs";`] : []),
      `import type { ${api}Operations } from "${imports.queries}";`,
      ...(runtimeNames.length === 0
        ? []
        : [`import { ${runtimeNames.join(", ")} } from "${imports.runtime}";`]),
      `import { ${api}Api } from "${imports.service}";`,
    ].join("\n"),
    SLICE_TYPES,
    AS_ERROR_SOURCE,
    ...(reads ? [OUTCOME_SOURCE, LATEST_READ_SOURCE, READ_SENDER_SOURCE] : []),
    ...(writes ? [WRITE_SENDER_SOURCE] : []),
    ...(keyedWrites ? [ACTION_KEY_SOURCE] : []),
    ...features,
  ].join("\n\n");
}

function pascalName(operation: QueryOperation): string {
  return typeScriptIdentifier(deriveName(splitName(operation.names.base), NAME_ROLE));
}

function methodName(operation: QueryOperation): string {
  return `${METHOD_PREFIX}${pascalName(operation)}`;
}

function featureSource(operation: QueryOperation, api: string): string {
  const base = operation.names.base;
  const types = operationType(operation, api);
  const sliceType = `SliceOf<${types}>`;
  const callType = callOptionsType(operation, api);
  const callParameter = callParameterSource(operation, callType);
  const isRead = operation.form === "query";
  const optionsParameter = isRead ? "options: ReadFeatureOptions = {}" : "";
  const sender = isRead ? readSenderCall(operation, types) : writeSenderCall(operation, api, types);
  const what = isRead
    ? "reads the latest per request, nothing on the server unless given a `transferId`"
    : `writes side by side${actionKeyOf(operation) === undefined ? "" : ", each with its own idempotency key unless `call` gives one"}`;

  return `/**
 * The feature of ${JSON.stringify(operation.operationId)}, to compose into the app's \`signalStore\`: the state slice \`${base}\`
 * and \`${methodName(operation)}\`, which ${what}.
 * It resolves to the slice its call settled.
 */
export function ${FEATURE_PREFIX}${pascalName(operation)}(${optionsParameter}) {
return signalStoreFeature(
ngrxWithState<{ ${base}: ${sliceType} }>({ ${base}: IDLE_SLICE }),
ngrxWithMethods((store, api = inject(${api}Api)) => {
const send = ${sender};

return {
${methodName(operation)}: (request: ${types}["request"], ${callParameter}): Promise<${sliceType}> => send(request, call),
};
}),
);
}`;
}

// The call options a method takes: required when the client method requires a timeout, else possibly absent.
function callArgumentType(operation: QueryOperation, callType: string): string {
  return operation.needsTimeout ? callType : `${callType} | undefined`;
}

function sliceWriter(operation: QueryOperation): string {
  const base = operation.names.base;

  return `(slice) => {
patchState(store, { ${base}: slice });
}`;
}

function readSenderCall(operation: QueryOperation, types: string): string {
  return `readSender<${types}["request"], ${callArgumentType(operation, `${types}["call"]`)}, ${types}["data"]>(
(request) => ${readKeyExpression(operation, "request")},
(request, call, signal) => api.queries.${operation.names.options}(request, call).fetcher(signal),
${sliceWriter(operation)},
options,
)`;
}

function writeSenderCall(operation: QueryOperation, api: string, types: string): string {
  const send = writeSendSource(operation, api, {
    parameters: "request, callOptions, attempt",
    request: "request",
    call: "callOptions",
    attempt: "attempt",
  });

  return `writeSender<${types}["request"], ${callArgumentType(operation, callOptionsType(operation, api))}, ${types}["data"]>(
${send},
${sliceWriter(operation)},
)`;
}
