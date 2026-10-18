import type {
  Awaitable,
  ErrorCodeWithParams,
  ExtensionMetadata,
  OperationRef,
  RequestView,
} from "./hook-vocabulary.js";
import type { ResolvedScope } from "./resolve-scope.js";

/** Allow, or a denial naming one of the requirement's declared codes with that code's params. */
export type Decision<Codes extends ErrorCodeWithParams> =
  | { readonly allow: true; readonly deny?: never }
  | { readonly deny: Codes; readonly allow?: never };

/** What a right is about: a resource type or a scope name, the id from its declared source, and the loaded record when a loader is registered. */
export interface SubjectRef<Type extends string = string, Id = unknown, LoadedRecord = unknown> {
  readonly type: Type;
  readonly id: Id;
  readonly record?: LoadedRecord;
}

/** Why the boundary asks: the route's requirement, a restricted field, or a restricted sort key. */
export type Purpose =
  | { readonly kind: "route" }
  | { readonly kind: "field"; readonly pointer: string; readonly direction: "input" | "output" }
  | { readonly kind: "sortKey"; readonly key: string };

/** The bucket a throttle rule counts in; the decider keeps the counter. */
export interface ThrottleBucket {
  readonly id: string;

  /** A fixed-size digest of the key values, never the raw values, so a counter store stays bounded. */
  readonly key: string;

  /** The values of the bucket's key sources, in declared order. */
  readonly values: readonly unknown[];

  /** Absent when the contract leaves the limit for the server to bind. */
  readonly limit?: number;

  /** Absent when the contract leaves the window for the server to bind. */
  readonly windowMs?: number;
}

/** What the decide hook receives for one right or rule; the generated request type narrows each member. */
export interface RequirementRequest<
  Codes extends ErrorCodeWithParams = ErrorCodeWithParams,
  Params = unknown,
  Principal = unknown,
  RequirementExtensions extends object = ExtensionMetadata,
  OperationExtensions extends object = ExtensionMetadata,
> {
  readonly kind: "right" | "rule";
  readonly name: string;

  /** The params declared at the use site. */
  readonly params?: Params;

  /** Null for an anonymous caller on a public or optional-auth route. */
  readonly principal: Principal | null;

  /** Present when the right has a subject. */
  readonly subject?: SubjectRef;

  /** Outermost first. */
  readonly scopes: readonly ResolvedScope[];

  /** The rule's proof, when the rule declares one. */
  readonly proof?: unknown;

  /** Present for a throttle rule. */
  readonly bucket?: ThrottleBucket;

  readonly purpose: Purpose;
  readonly operation: OperationRef;
  readonly request: RequestView;

  readonly extensions: {
    readonly requirement: RequirementExtensions;
    readonly operation: OperationExtensions;
  };

  /** Type-level only, never set by the boundary: the codes a denial may name. */
  readonly deniableCodes?: Codes;
}

/** The codes a decider for this request may deny with. */
export type DeniableCodes<Request extends RequirementRequest> = NonNullable<
  Request["deniableCodes"]
>;

/** One for every requirement, right or rule; the boundary loops over several requests. */
export interface DecideHook<Request extends RequirementRequest> {
  decide(request: Request): Awaitable<Decision<DeniableCodes<Request>>>;
}
