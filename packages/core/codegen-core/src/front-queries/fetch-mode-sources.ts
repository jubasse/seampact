import type { QueryOperation } from "./query-plan.js";

// The source parts of a plain fetch hooks or composables module every TypeScript front target shares (ADR 0021
// "Plain fetch"): the mutation outcome and caller option types, the rejection-to-`Error` helper, the retry rule and
// the check of the `retry` option, and the mutation function of the frameworks whose state lives in plain reactive
// cells (Vue refs, Angular signals). React's state stays in its target.

const ABORT_ERROR_NAME = "AbortError";

/** The type one `mutate` call resolves to. */
export const MUTATE_OUTCOME_TYPE = `/** What one \`mutate\` call resolves to: its data, or its error. */
export type MutateOutcome<Data, Failure> = { readonly data: Data; readonly error: undefined } | { readonly data: undefined; readonly error: Failure };`;

/** The helper that turns any rejection into an `Error`. */
export const AS_ERROR_SOURCE = `// A rejection as an \`Error\`, the value kept as its cause when it is not one.
function asError(rejection: unknown): Error {
return rejection instanceof Error ? rejection : new Error(String(rejection), { cause: rejection });
}`;

/** The caller options of a mutation hook or composable; `unitName` is what the framework calls it (`hook`, `composable`). */
export function mutationCallerOptionsSource(unitName: string): string {
  return `/** The caller's mutation ${unitName} options: \`retry\`, a whole count, sends a rejected write again that many times, with the same idempotency key. */
export interface MutationCallerOptions<Operation extends AnyOperationTypes> {
readonly call?: Operation["call"];
readonly retry?: number;
}`;
}

/**
 * The rule of which failed write is sent again: a declared error is the server's answer and an abort the caller's
 * choice, so only another rejection is retried.
 */
export function isRetryableSource(throwsErrors: boolean): string {
  const declared = throwsErrors ? "!isContractError(error) && " : "";

  return `function isRetryable(error: Error): boolean {
return ${declared}error.name !== ${JSON.stringify(ABORT_ERROR_NAME)};
}`;
}

/** The refusal of a `retry` option that is not a whole count; `nameParameter` names the hook or composable. */
export function retryCheckSource(nameParameter: string): string {
  return `if (!Number.isInteger(retry) || retry < 0) {
throw new Error(\`\${${nameParameter}}: the option retry is \${retry}, not a whole count of retries; pass 0 or more.\`);
}`;
}

/** The options parameter of a hook or composable, required when the client method requires a timeout. */
export function callerOptionsParameter(operation: QueryOperation, type: string): string {
  return operation.needsTimeout ? `options: WithRequiredCall<${type}>` : `options?: ${type}`;
}

/** How a framework builds and writes the reactive cells a fetch mutation keeps its state in. */
export interface ReactiveCells {
  // The function the mutation is named, and the name of its parameter naming the generated member.
  readonly functionName: string;
  readonly memberNameParameter: string;
  // The cell constructor, as in `shallowRef` or `signal`.
  readonly cellConstructor: string;
  // The statement writing `value` into the cell `cell`.
  readonly write: (cell: string, value: string) => string;
}

/**
 * The fetch mutation over reactive cells: one attempt object per \`mutate\`, passed to each retry, so the retries
 * keep one idempotency key even when the options are rebuilt per attempt; only the latest \`mutate\` writes the cells,
 * and every call resolves to its own outcome. A write is not aborted when its owner is destroyed.
 */
export function cellsMutationSource(cells: ReactiveCells): string {
  const { cellConstructor, write } = cells;

  return `function ${cells.functionName}<Request, Data>(
${cells.memberNameParameter}: string,
fetcher: (request: Request, attempt: object) => Promise<Data>,
retry: number,
): MutationState<Request, Data, Error> {
${retryCheckSource(cells.memberNameParameter)}

const data = ${cellConstructor}<Data | undefined>(undefined);
const error = ${cellConstructor}<Error | undefined>(undefined);
const isPending = ${cellConstructor}(false);
let latestMutate = 0;

const mutate = async (request: Request): Promise<MutateOutcome<Data, Error>> => {
const mutateNumber = latestMutate + 1;
const attempt = {};
const settle = (nextData: Data | undefined, nextError: Error | undefined) => {
if (latestMutate !== mutateNumber) return;

${write("data", "nextData")}
${write("error", "nextError")}
${write("isPending", "false")}
};

latestMutate = mutateNumber;
${write("data", "undefined")}
${write("error", "undefined")}
${write("isPending", "true")}

for (let retriesLeft = retry; ; retriesLeft -= 1) {
try {
const answer = await fetcher(request, attempt);

settle(answer, undefined);

return { data: answer, error: undefined };
} catch (rejection) {
const failure = asError(rejection);

if (retriesLeft <= 0 || !isRetryable(failure)) {
settle(undefined, failure);

return { data: undefined, error: failure };
}
}
}
};

return { mutate, isPending, error, data };
}`;
}
