import type {
  Awaitable,
  ErrorCodeWithParams,
  ExtensionMetadata,
  RequestView,
} from "./hook-vocabulary.js";

/** A resolved scope: its id and an optional application value, carried untouched to later hooks and the handler. */
export interface ResolvedScope<Id = unknown, Value = unknown> {
  readonly scope: string;
  readonly id: Id;
  readonly value?: Value;
}

/** Where the scope id comes from: the declared source, decoded and validated, or a custom resolver reading the request. */
export type ScopeIdSource<Id = unknown> =
  | { readonly resolver: "declared"; readonly id: Id }
  | { readonly resolver: "custom"; readonly request: RequestView };

/** What the resolve-scope hook of one scope kind receives; the generated request type narrows each member. */
export interface ResolveScopeRequest<
  Id = unknown,
  Principal = unknown,
  ScopeExtensions extends object = ExtensionMetadata,
  OperationExtensions extends object = ExtensionMetadata,
> {
  readonly scope: string;
  readonly source: ScopeIdSource<Id>;

  /** Null for an anonymous caller on a public or optional-auth route. */
  readonly principal: Principal | null;

  /** The scopes resolved before this one, outermost first. */
  readonly outerScopes: readonly ResolvedScope[];

  readonly extensions: {
    readonly scope: ScopeExtensions;
    readonly operation: OperationExtensions;
  };
}

/** The resolved scope, or one of the scope's declared membership denials. */
export type ScopeResolution<Scope extends ResolvedScope, Denial extends ErrorCodeWithParams> =
  | { readonly resolved: Scope; readonly deny?: never }
  | { readonly deny: Denial; readonly resolved?: never };

/** One per scope kind, called outermost scope first. */
export interface ResolveScopeHook<
  Request extends ResolveScopeRequest,
  Scope extends ResolvedScope,
  Denial extends ErrorCodeWithParams,
> {
  resolveScope(request: Request): Awaitable<ScopeResolution<Scope, Denial>>;
}
