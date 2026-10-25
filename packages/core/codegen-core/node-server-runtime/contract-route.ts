// The route table a Node server boundary reads: one entry per contract operation, emitted from the IR, and the
// request view every check step receives. Copied into the generated tree as is.
import type { SignatureTemplate } from "@seampact/hooks";
import type { FrameworkRouteCheck } from "./framework-route-patterns.js";
import {
  decodePathParam,
  decodeQueryMembers,
  decodeWireString,
  type ParamRule,
} from "./wire-decoding.js";

export type ResponsesMode = "strict" | "warn";

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
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "literal"; readonly value: unknown }
  /** Each element of an array slot, rendered with `as` where the slot `item` holds it. */
  | { readonly kind: "each"; readonly of: string; readonly as: FormatTemplate };

/** How a template writes a slot without a value: the member is omitted, or written `null` (IR section 7). */
export type AbsentRendering = "omit" | "null";

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
  /** The code's written title; absent when it declares none, and the body then has no title. */
  readonly title?: string;
  readonly status: number;
  readonly nature: string;
  /** The roles the code answers (`unauthenticated`, `forbidden`, `schemaInvalid`, ...). */
  readonly roles: readonly string[];
  /** Per role, the template filling the code's params from the role's data; absent when the code has no params. */
  readonly roleParams?: Readonly<Record<string, FormatTemplate>>;
  /** A header derived from one of the code's params, such as `Retry-After` in seconds. */
  readonly retryHeader?: {
    readonly name: string;
    readonly param: string;
    readonly unit: "s" | "ms";
  };
  /** Set when the code's params carry a sensitive value: its reply is `Cache-Control: no-store`. */
  readonly noStore?: true;
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
      /** The principal schema's name and its validator, which every principal a hook returns must pass. */
      readonly principalSchema: string;
      readonly principalValidator: StandardValidator;
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
  /** On a table: the item property each key of the body equals. */
  readonly tableKeyProperty?: string;
  /** The format's envelope of an item, list or table body, its `$payload` slot the handler's body; absent when bare. */
  readonly envelope?: { readonly body: FormatTemplate; readonly absent: AbsentRendering };
  /** The members leading from the body to its payload, or a page's items; empty when the body is the payload. */
  readonly payloadPath: readonly string[];
}

/** A template the page writes under a name: a `meta` member or a response header. */
export interface NamedPageTemplate {
  readonly name: string;
  readonly value: FormatTemplate;
}

/** A paging style as the boundary renders it (ADR 0002 section 14). */
export interface PagingEntry {
  readonly position: "cursor" | "page" | "offset" | "since";
  /** The query member of the position: the cursor, page, offset or since token; with `after` and `before`, `after`. */
  readonly positionParam: string;
  /** With `after` and `before`: the query member the previous page's cursor travels in. */
  readonly beforeParam?: string;
  /** The number of the first page, on a page position. */
  readonly base: number;
  /** The limit query member and the value the handler receives when the client sends none. */
  readonly limitParam?: string;
  readonly defaultLimit?: number;
  /** The members the handler returns beside the items: `total`, `more`, `nextCursor`, ... */
  readonly handlerResult: readonly string[];
  readonly absent: AbsentRendering;
  /** The page body: the style's own, or the format's page with the style's `meta` in its `$meta`. */
  readonly body: FormatTemplate;
  readonly meta: readonly NamedPageTemplate[];
  readonly headers: readonly NamedPageTemplate[];
  /** The relations of the `Link` header, each a URL role. */
  readonly links: readonly { readonly rel: string; readonly role: string }[];
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
  /** Keyed by the input pointer, `/body/title`, an array item written `*`. */
  readonly idempotency?: {
    readonly header: string;
    readonly replayHeader: string;
    readonly lifetimeMs: number;
    /** The author-declared header params, lower case: the only headers the fingerprint digests. */
    readonly fingerprintHeaders: readonly string[];
  };
  readonly responses: readonly ResponseEntry[];
  readonly errors: Readonly<Record<string, ErrorEntry>>;
  readonly paging?: PagingEntry;
  readonly cache?: {
    readonly etag: boolean;
    /** The `Cache-Control` value per caller kind, `identified` or `anonymous`. */
    readonly cacheControl: Readonly<Record<string, string>>;
    /** Authoritative: the reply is never stored, `Cache-Control: no-store`, whatever the caller. */
    readonly noStore: boolean;
    readonly vary: readonly string[];
  };
}

export interface ContractApi {
  readonly id: string;
  /** The resolved prefix of each surface, as `/v1`: a path under one that no route serves is the api's 404. */
  readonly basePaths: readonly string[];
  readonly format: ErrorFormat;
  readonly routes: readonly ContractRoute[];
  readonly shapes: Readonly<Record<string, ValueShape>>;
  /** The app config's check of the app's routes outside the contract, run by the boot check. */
  readonly frameworkRoutes: FrameworkRouteCheck;
  /** The app config's level for the boot check of the hooks: `error` refuses to boot, `warn` logs, `off` is silent. */
  readonly hookCheck: "error" | "warn" | "off";
  /** Fastify only: `off` leaves the reply uncompressed even when `@fastify/compress` is registered. */
  readonly compression: "off" | { readonly thresholdBytes: number };
  /** `strip` removes an ETag the framework added to a reply the boundary did not write; `keep` leaves it. */
  readonly frameworkEtag: "strip" | "keep";
  /** False leaves a request the contract does not serve (an unserved method or path under a base path) to the app. */
  readonly catchAll: boolean;
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
const GET_METHOD = "get";
const HEAD_METHOD = "head";

/**
 * The route serving a method and a path, with its path params still percent-encoded. HEAD is served by the path's
 * GET operation, whose reply goes out without its body (RFC 9110 9.3.2).
 */
export function matchContractRoute(
  api: ContractApi,
  method: string,
  path: string,
): { readonly route: ContractRoute; readonly pathParams: Record<string, string> } | undefined {
  const lowerMethod = method.toLowerCase();
  const servedMethod = lowerMethod === HEAD_METHOD ? GET_METHOD : lowerMethod;

  for (const route of api.routes) {
    if (route.method !== servedMethod) continue;

    const pathParams = matchPath(route.path, path);

    if (pathParams !== undefined) return { route, pathParams };
  }

  return undefined;
}

/** The method's route serving a path, else the first route whose template the path matches, whatever its method. */
export function matchContractPath(
  api: ContractApi,
  method: string,
  path: string,
): { readonly route: ContractRoute; readonly pathParams: Record<string, string> } | undefined {
  const served = matchContractRoute(api, method, path);

  if (served !== undefined) return served;

  for (const route of api.routes) {
    const pathParams = matchPath(route.path, path);

    if (pathParams !== undefined) return { route, pathParams };
  }

  return undefined;
}

/** Whether a path matches any route's template, whatever the method. */
export function matchesContractPath(api: ContractApi, path: string): boolean {
  return api.routes.some((route) => matchPath(route.path, path) !== undefined);
}

/**
 * Whether a raw path is under one of the api's base paths, case-sensitive and at a segment boundary: such a path
 * that no route serves exactly is the api's 404, any other path the app's. An empty base path claims no path, so an
 * api without a prefix leaves the app's 404s alone.
 */
export function isUnderBasePath(api: Pick<ContractApi, "basePaths">, path: string): boolean {
  return api.basePaths.some(
    (basePath) => basePath !== "" && (path === basePath || path.startsWith(`${basePath}/`)),
  );
}

/** Whether a path is a contract path under a leading prefix, as a framework's global prefix makes it. */
export function isUnderPrefix(api: ContractApi, path: string): boolean {
  return api.routes.some((route) => compiledTemplate(route.path).prefixed.test(path));
}

function matchPath(template: string, path: string): Record<string, string> | undefined {
  const compiled = compiledTemplate(template);
  const match = compiled.exact.exec(path);

  if (match === null) return undefined;

  return Object.fromEntries(compiled.names.map((name, index) => [name, match[index + 1] ?? ""]));
}

interface CompiledTemplate {
  readonly exact: RegExp;
  readonly prefixed: RegExp;
  readonly names: readonly string[];
}

// Keyed by a route table's path template, never by request input, so it holds one entry per contract route.
const compiledTemplates = new Map<string, CompiledTemplate>();

function compiledTemplate(template: string): CompiledTemplate {
  const cached = compiledTemplates.get(template);

  if (cached !== undefined) return cached;

  const names: string[] = [];
  const pattern = templatePattern(template, names);
  const compiled = {
    exact: new RegExp(`^${pattern}$`),
    prefixed: new RegExp(`^/.+${pattern}$`),
    names,
  };

  compiledTemplates.set(template, compiled);

  return compiled;
}

// The template as a regular expression source, each param one path segment; collects the param names.
function templatePattern(template: string, names: string[]): string {
  return template
    .split(PATH_PARAM)
    .map((part, index) => {
      if (index % 2 === 1) {
        names.push(part);

        return "([^/]+)";
      }

      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
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

    if (raw !== undefined) path[rule.name] = decodeWireString(decodePathParam(raw), rule.decoding);
  }

  const query = decodeQueryMembers(route.params.query, request.rawQuery);
  const headers: Record<string, unknown> = {};

  for (const rule of route.params.headers) {
    const raw = request.headers[rule.name];
    const value = Array.isArray(raw) ? raw.join(", ") : raw;

    if (typeof value === "string") headers[rule.name] = decodeWireString(value, rule.decoding);
  }

  return { path, query, headers };
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
