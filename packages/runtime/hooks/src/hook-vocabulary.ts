/** A value, or a promise of it: a hook or a store may answer either way. */
export type Awaitable<T> = T | Promise<T>;

/** The operation a hook is called for, as the IR names it. */
export interface OperationRef {
  readonly kind: "httpOperation";
  readonly api: string;
  readonly id: string;
}

/** A read-only view of the HTTP request, the same for every hook. */
export interface RequestView {
  readonly method: string;
  readonly path: string;

  /** Header names in lower case; a repeated header keeps every value in order. */
  readonly headers: Readonly<Record<string, readonly string[]>>;

  /** The address the framework reports for the client, absent when it reports none. */
  readonly clientAddress?: string;
}

/** Extension values declared on a right, rule, scope or operation, typed by the generated code from their JSON Schemas. */
export type ExtensionMetadata = Readonly<Record<string, unknown>>;

/** A declared error code and its typed params, the only thing a hook may deny with. */
export interface ErrorCodeWithParams {
  readonly code: string;
  readonly params?: unknown;
}
