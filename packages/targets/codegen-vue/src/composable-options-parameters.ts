import type { QueryOperation } from "@seampact/codegen-core";

// The options parameters of the generated Vue composables, shared by the query library modules.

/** A query composable's options: a value, a `ref` or a getter, required when the client method requires a timeout. */
export function reactiveOptionsParameter(operation: QueryOperation, type: string): string {
  return operation.needsTimeout
    ? `options: MaybeRefOrGetter<WithRequiredCall<${type}>>`
    : `options?: MaybeRefOrGetter<${type} | undefined>`;
}

/** A mutation composable's options, required when the client method requires a timeout. */
export function mutationOptionsParameter(operation: QueryOperation, type: string): string {
  return operation.needsTimeout ? `options: WithRequiredCall<${type}>` : `options?: ${type}`;
}
