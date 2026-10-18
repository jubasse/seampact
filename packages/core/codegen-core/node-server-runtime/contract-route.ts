// The route table a Node server boundary reads: one entry per contract operation, emitted from the IR, and the
// request view every check step receives. Copied into the generated tree as is.
import type { SignatureTemplate } from "@seampact/hooks";

export type ResponsesMode = "strict" | "warn";

/** How a path, query or header string is decoded by the IR's wire form before the validator (ADR 0002 section 7). */
export type WireDecoding = "text" | "number" | "boolean" | "list";

export interface ParamRule {
  /** The name as the validator's input object keys it: as declared for path and query, lower case for headers. */
  readonly name: string;
  readonly decoding: WireDecoding;
}

/** A Standard Schema v1 value, as the validators link provides it. */
export interface StandardValidator {
  readonly "~standard": {
    validate(value: unknown): StandardResult | Promise<StandardResult>;
  };
}

export type StandardResult =
  | { readonly value: unknown; readonly issues?: undefined }
  | { readonly issues: readonly StandardIssue[] };

export interface StandardIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

/** The output shape of a value, for stripping undeclared members: a leaf, a schema, a list or an object. */
export type ValueShape =
  | { readonly kind: "leaf" }
  | { readonly kind: "ref"; readonly schema: string }
  | { readonly kind: "array"; readonly items: ValueShape }
  | { readonly kind: "object"; readonly properties: Readonly<Record<string, ValueShape>> };

/** One template node of the api's error format: an object of members, a slot, or literal text. */
export type FormatTemplate =
  | {
      readonly kind: "object";
      readonly members: readonly { readonly name: string; readonly value: FormatTemplate }[];
    }
  | { readonly kind: "slot"; readonly slot: string; readonly path: readonly string[] }
  | { readonly kind: "text"; readonly text: string };

export interface ErrorFormat {
  readonly media: string;
  readonly body: FormatTemplate;
  /** The body member that carries the code, read back by the outgoing response check. */
  readonly codeMember: string;
  /** Whether the code's params are merged into the body's top object. */
  readonly mergeParams: boolean;
}

export interface ErrorEntry {
  readonly code: string;
  /** The code's declared title; the code stands in when it declares none. */
  readonly title?: string;
  readonly status: number;
  readonly nature: string;
  /** The roles the code answers (`unauthenticated`, `forbidden`, `schemaInvalid`, ...). */
  readonly roles: readonly string[];
  /** A header derived from one of the code's params, such as `Retry-After` in seconds. */
  readonly retryHeader?: {
    readonly name: string;
    readonly param: string;
    readonly unit: "s" | "ms";
  };
}

export interface CredentialSource {
  readonly scheme: string;
  readonly in: "bearer" | "cookie" | "header";
  /** The cookie or header name; absent for a bearer scheme. */
  readonly name?: string;
}

export interface SignedSource {
  readonly scheme: string;
  readonly header: string;
  /** The signature header's format, such as `t={ts},v1={sig}`. */
  readonly format: string;
  readonly keyId: string;
  readonly template: SignatureTemplate;
}

export type AccessEntry =
  | { readonly kind: "public" }
  | {
      readonly kind: "identity";
      readonly identity: string;
      readonly anonymousAllowed: boolean;
      readonly credentials: readonly CredentialSource[];
      readonly signed?: SignedSource;
      /** The CSRF companion header read on a write authenticated by a cookie scheme. */
      readonly csrfHeader?: string;
    };

/** Where a value comes from: a path param, a resolved scope's id, a principal member or a holder's member. */
export interface ValueSource {
  readonly in: "path" | "scope" | "principal" | "holderField";
  readonly name: string;
}

export interface SubjectEntry {
  readonly type: string;
  readonly source: ValueSource;
}

export interface BucketEntry {
  readonly id: string;
  readonly key: readonly ValueSource[];
  readonly limit?: number;
  readonly windowMs?: number;
}

export interface RequirementEntry {
  readonly kind: "right" | "rule";
  readonly name: string;
  readonly params?: unknown;
  readonly subject?: SubjectEntry;
  /** The body member holding the rule's proof. */
  readonly proof?: string;
  readonly bucket?: BucketEntry;
  /** The codes a denial may name, first declared first. */
  readonly errors: readonly string[];
}

export interface ScopeEntry {
  readonly scope: string;
  readonly source: ValueSource;
  readonly errors: readonly string[];
}

export interface FieldRightEntry {
  readonly direction: "input" | "output";
  /** A top-level member of the schema, as `/effort`. */
  readonly pointer: string;
  readonly right: string;
  readonly schema: string;
  readonly params?: unknown;
  readonly subject?: SubjectEntry;
  /** On input: refuse a field sent without its right with 403, or strip it (A21). */
  readonly inputPolicy?: "reject" | "strip";
  readonly errors: readonly string[];
}

export interface ResponseEntry {
  readonly status: number;
  readonly shape: "item" | "list" | "table" | "page" | "empty";
  readonly body?: ValueShape;
  /** Present when the target option `bodyValidation` is on: validates one item of the body. */
  readonly itemValidator?: StandardValidator;
}

export interface ContractRoute {
  readonly id: string;
  readonly method: string;
  /** The contract path with `{name}` params, as `/v1/channels/{channelId}/tasks`. */
  readonly path: string;
  readonly safe: boolean;
  readonly access: AccessEntry;
  readonly scopes: readonly ScopeEntry[];
  readonly requires: readonly RequirementEntry[];
  readonly fieldRights: readonly FieldRightEntry[];
  readonly params: {
    readonly path: readonly ParamRule[];
    readonly query: readonly ParamRule[];
    readonly headers: readonly ParamRule[];
  };
  readonly input?: {
    readonly media: string;
    readonly limitBytes: number;
    readonly rawBody: boolean;
  };
  readonly validator: StandardValidator;
  readonly idempotency?: {
    readonly header: string;
    readonly replayHeader: string;
    readonly lifetimeMs: number;
  };
  readonly responses: readonly ResponseEntry[];
  readonly errors: Readonly<Record<string, ErrorEntry>>;
  readonly paging?: { readonly cursorParam: string; readonly nextCursorMember: string };
  readonly cache?: {
    readonly etag: boolean;
    /** The `Cache-Control` value per caller kind, `identified` or `anonymous`. */
    readonly cacheControl: Readonly<Record<string, string>>;
    readonly vary: readonly string[];
  };
}

export interface ContractApi {
  readonly id: string;
  readonly format: ErrorFormat;
  readonly routes: readonly ContractRoute[];
  readonly shapes: Readonly<Record<string, ValueShape>>;
}

/** The request as every check step sees it, whatever the framework. */
export interface ContractRequest {
  readonly method: string;
  /** The path as received, before percent-decoding. */
  readonly path: string;
  /** The raw query string, without `?`. */
  readonly rawQuery: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** The body the platform's parser decoded, undefined when there is none. */
  readonly body: unknown;
  /** The body exactly as received, when the setup keeps it. */
  readonly rawBody?: Uint8Array;
  readonly clientAddress?: string;
}

const PATH_PARAM = /\{([^}]+)\}/g;

/** The route serving a method and a path, with its path params still percent-encoded. */
export function matchContractRoute(
  api: ContractApi,
  method: string,
  path: string,
): { readonly route: ContractRoute; readonly pathParams: Record<string, string> } | undefined {
  const lowerMethod = method.toLowerCase();

  for (const route of api.routes) {
    if (route.method !== lowerMethod) continue;

    const pathParams = matchPath(route.path, path);

    if (pathParams !== undefined) return { route, pathParams };
  }

  return undefined;
}

/** Whether a path matches any route's template, whatever the method. */
export function matchesContractPath(api: ContractApi, path: string): boolean {
  return api.routes.some((route) => matchPath(route.path, path) !== undefined);
}

function matchPath(template: string, path: string): Record<string, string> | undefined {
  const names: string[] = [];
  const pattern = template
    .split(PATH_PARAM)
    .map((part, index) => {
      if (index % 2 === 1) {
        names.push(part);

        return "([^/]+)";
      }

      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  const match = new RegExp(`^${pattern}$`).exec(path);

  if (match === null) return undefined;

  return Object.fromEntries(names.map((name, index) => [name, match[index + 1] ?? ""]));
}

/** The path, query and header values the validator receives, decoded by their wire forms. */
export function decodeRequestParams(
  route: ContractRoute,
  request: ContractRequest,
  pathParams: Readonly<Record<string, string>>,
): {
  path: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
} {
  const path: Record<string, unknown> = {};

  for (const rule of route.params.path) {
    const raw = pathParams[rule.name];

    if (raw !== undefined) path[rule.name] = decodeWireString(safeDecode(raw), rule.decoding);
  }

  const query: Record<string, unknown> = {};

  for (const [name, raw] of new URLSearchParams(request.rawQuery)) {
    const rule = route.params.query.find((candidate) => candidate.name === name);

    // An undeclared or repeated member reaches the strict validator raw, so it reports it.
    query[name] =
      rule === undefined || Object.hasOwn(query, name) ? raw : decodeWireString(raw, rule.decoding);
  }

  const headers: Record<string, unknown> = {};

  for (const rule of route.params.headers) {
    const raw = request.headers[rule.name];
    const value = Array.isArray(raw) ? raw.join(", ") : raw;

    if (typeof value === "string") headers[rule.name] = decodeWireString(value, rule.decoding);
  }

  return { path, query, headers };
}

const NUMBER_TEXT = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

// A value that does not decode stays the raw string, so the validator reports it with every other issue.
function decodeWireString(raw: string, decoding: WireDecoding): unknown {
  switch (decoding) {
    case "text":
      return raw;
    case "number":
      return NUMBER_TEXT.test(raw) ? Number(raw) : raw;
    case "boolean":
      return raw === "true" ? true : raw === "false" ? false : raw;
    case "list":
      return raw === "" ? [] : raw.split(",");
  }
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed escape stays raw so the validator reports the value.
    return raw;
  }
}

/** A header's values in lower case, each value kept, for a hook's request view. */
export function headerValues(
  headers: ContractRequest["headers"],
): Readonly<Record<string, readonly string[]>> {
  const values: Record<string, readonly string[]> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;

    values[name.toLowerCase()] = typeof value === "string" ? [value] : [...value];
  }

  return values;
}

/** A single header value, or undefined when absent. */
export function headerValue(headers: ContractRequest["headers"], name: string): string | undefined {
  const value = headers[name.toLowerCase()];

  return Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
}
