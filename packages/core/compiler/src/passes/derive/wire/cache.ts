import type { IrWriter } from "@seampact/spec/ir";
import {
  type InheritedEntry,
  pipelineCopy,
  pipelineIsJsonObject,
  pipelineParseDuration,
} from "../../../pipeline/seam.js";
import { DERIVE_WIRE_ETAG } from "./concurrency.js";
import { deriveWireCredentialPlace, deriveWireSchemeOf } from "./credentials.js";
import {
  DERIVE_WIRE_STRING_USE,
  type DeriveWireDerived,
  deriveWireAddParam,
  deriveWireAddResponseHeader,
  deriveWireSuccessResponses,
} from "./params.js";
import { type DeriveWireRoute, type DeriveWireScope, deriveWireOriginAt } from "./routes.js";
import { type DeriveWireSensitiveField, deriveWireSensitiveField } from "./sensitive.js";

// The cache of an operation (ADR 0002 section 10, ADR 0006 section 5). `cache.headers`: an inherited `cache` applies
// to GET routes; its `freshness` names a family of `conventions.cache.families`, or `never` (no-store). The
// `Cache-Control` value is written per caller kind the access admits: an anonymous caller gets the family's
// directives as `anonymous` says (`private` by default), the shared-cache ones (`s-maxage`) on public values only,
// and an identified caller always gets private. `Vary` lists the credential headers of the accepted schemes, then
// `cache.vary`. `cache.etag`: the `ETag` header on every success (the item's version tag where `If-Match` versions
// it), the optional `If-None-Match` parameter and an
// empty 304 response carrying the `ETag`. `cache.sensitive`: a response carrying a sensitive field is no-store, so
// an operation without `cache` gets `{ family: never, noStore }` located at the field, and a family other than
// `never` there is a compile error naming the field and the route.

const NEVER = "never";

const GET = "get";

const NO_STORE = "no-store";

const NOT_MODIFIED = 304;

const SECOND_MS = 1000;

const COOKIE_HEADER = "Cookie";

const CACHE_HEADERS = "cache.headers";

const CACHE_ETAG = "cache.etag";

const CACHE_SENSITIVE = "cache.sensitive";

type Directives = IrWriter.CacheDirectives;

type CallerKind = IrWriter.CallerCacheControl["caller"];

/** Writes the operation's `cache`, its ETag headers and 304 response, or the no-store a sensitive field needs. */
export function deriveWireCache(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const setting = scope.context.inherited(route.node, "cache")?.entry;
  const isGet = route.operation.method === GET;

  if (setting !== undefined && !isGet && setting.node === route.node) {
    reportMethod(route, setting, scope);

    return;
  }

  const sensitive = deriveWireSensitiveField(route, scope);

  if (setting === undefined || !isGet) {
    if (sensitive !== undefined) route.operation.cache = sensitiveNoStore(route, sensitive);

    return;
  }

  const written = cacheOf(route, setting, sensitive, scope);

  if (written === undefined) return;

  route.operation.cache = written;

  if (written.etag) writeEntityTag(route, setting.origin, scope);
}

function cacheOf(
  route: DeriveWireRoute,
  setting: InheritedEntry,
  sensitive: DeriveWireSensitiveField | undefined,
  scope: DeriveWireScope,
): IrWriter.Cache | undefined {
  const value = setting.value;

  if (!pipelineIsJsonObject(value))
    throw new Error(
      `cache at ${setting.origin.pointer} is no mapping, which the authoring schema refuses`,
    );

  const family = value.freshness;

  if (typeof family !== "string") {
    reportFamily(setting, "names no freshness", scope);

    return undefined;
  }

  if (family !== NEVER && sensitive !== undefined) {
    reportSensitive(route, setting, { family, sensitive }, scope);

    return undefined;
  }

  const directives = family === NEVER ? undefined : directivesOf(family, setting, scope);

  if (family !== NEVER && directives === undefined) return undefined;

  const anonymous: IrWriter.CacheVisibility = value.anonymous === "public" ? "public" : "private";
  const from = [pipelineCopy(setting.origin)];

  if (directives !== undefined)
    from.push(pipelineCopy(deriveWireOriginAt(scope, `/conventions/cache/families/${family}`)));

  return {
    family,
    ...(directives === undefined ? {} : { directives }),
    anonymous,
    vary: varyOf(route, value.vary, scope),
    etag: value.etag === true,
    perCallerKind: callerKindsOf(route).map((caller) => ({
      caller,
      cacheControl: cacheControlOf(directives, caller === "anonymous" && anonymous === "public"),
    })),
    noStore: directives === undefined,
    origin: pipelineCopy(setting.origin),
    derivedFrom: { derivation: CACHE_HEADERS, from },
  };
}

function sensitiveNoStore(
  route: DeriveWireRoute,
  sensitive: DeriveWireSensitiveField,
): IrWriter.Cache {
  return {
    family: NEVER,
    anonymous: "private",
    vary: [],
    etag: false,
    perCallerKind: callerKindsOf(route).map((caller) => ({ caller, cacheControl: NO_STORE })),
    noStore: true,
    origin: pipelineCopy(sensitive.origin),
    derivedFrom: { derivation: CACHE_SENSITIVE, from: [pipelineCopy(sensitive.origin)] },
  };
}

// A family is a max-age (`60s`) or a mapping of directives in camel case; durations become milliseconds.
function directivesOf(
  family: string,
  setting: InheritedEntry,
  scope: DeriveWireScope,
): Directives | undefined {
  const reading = scope.context.conventions.get(`cache.families.${family}`);

  if (reading === undefined) {
    reportFamily(
      setting,
      `names the family '${family}', which conventions.cache.families does not declare`,
      scope,
    );

    return undefined;
  }

  const written = reading.value;
  const members = pipelineIsJsonObject(written) ? written : { maxAge: written };
  const durationOf = (key: string): number | undefined => {
    const text = members[key];

    if (text === undefined) return undefined;

    const ms = typeof text === "string" ? pipelineParseDuration(text) : undefined;

    if (ms === undefined)
      throw new Error(
        `conventions.cache.families.${family}.${key} is no duration, which the authoring schema refuses`,
      );

    return ms;
  };
  const maxAgeMs = durationOf("maxAge");

  if (maxAgeMs === undefined) {
    reportFamily(setting, `names the family '${family}', which sets no maxAge`, scope);

    return undefined;
  }

  const sharedMaxAgeMs = durationOf("sharedMaxAge");
  const staleWhileRevalidateMs = durationOf("staleWhileRevalidate");
  const staleIfErrorMs = durationOf("staleIfError");

  return {
    maxAgeMs,
    ...(sharedMaxAgeMs === undefined ? {} : { sharedMaxAgeMs }),
    ...(staleWhileRevalidateMs === undefined ? {} : { staleWhileRevalidateMs }),
    ...(staleIfErrorMs === undefined ? {} : { staleIfErrorMs }),
    immutable: members.immutable === true,
    noCache: members.noCache === true,
    mustRevalidate: members.mustRevalidate === true,
  };
}

// The `Cache-Control` value; `shared` adds the shared-cache directives of a public value.
function cacheControlOf(directives: Directives | undefined, shared: boolean): string {
  if (directives === undefined) return NO_STORE;

  const seconds = (ms: number): number => Math.floor(ms / SECOND_MS);
  const parts = [shared ? "public" : "private", `max-age=${seconds(directives.maxAgeMs)}`];

  if (shared && directives.sharedMaxAgeMs !== undefined)
    parts.push(`s-maxage=${seconds(directives.sharedMaxAgeMs)}`);

  if (directives.staleWhileRevalidateMs !== undefined)
    parts.push(`stale-while-revalidate=${seconds(directives.staleWhileRevalidateMs)}`);

  if (directives.staleIfErrorMs !== undefined)
    parts.push(`stale-if-error=${seconds(directives.staleIfErrorMs)}`);

  if (directives.immutable) parts.push("immutable");

  if (directives.noCache) parts.push("no-cache");

  if (directives.mustRevalidate) parts.push("must-revalidate");

  return parts.join(", ");
}

function callerKindsOf(route: DeriveWireRoute): CallerKind[] {
  const access = route.operation.access;

  if (access === undefined) throw new Error(`access.identity wrote no access on '${route.id}'`);

  switch (access.kind) {
    case "public":
      return ["anonymous"];
    case "identity":
      return ["identified"];
    case "optional":
      return ["anonymous", "identified"];
  }
}

// The credential headers of the accepted schemes (a query credential varies the URL itself), then `cache.vary`,
// each name once, compared case-insensitively.
function varyOf(route: DeriveWireRoute, written: unknown, scope: DeriveWireScope): string[] {
  const access = route.operation.access;
  const names: string[] = [];
  const add = (name: string): void => {
    if (!names.some((known) => known.toLowerCase() === name.toLowerCase())) names.push(name);
  };

  if (access !== undefined && access.kind !== "public")
    for (const id of access.schemes) {
      const scheme = deriveWireSchemeOf(id, scope);
      const place = deriveWireCredentialPlace(scheme);

      if (scheme.kind === "cookie") add(COOKIE_HEADER);
      else if (place?.in === "header") add(place.name);
    }

  if (Array.isArray(written)) for (const name of written) if (typeof name === "string") add(name);

  return names;
}

// A response of an item versioned by `If-Match` already carries the tag `cache.etag` uses.
const isVersionTag = (header: IrWriter.ResponseHeader): boolean =>
  header.name === DERIVE_WIRE_ETAG && header.derivedFrom?.derivation === "concurrency.version";

function writeEntityTag(
  route: DeriveWireRoute,
  origin: IrWriter.Origin,
  scope: DeriveWireScope,
): void {
  const derived = (name: string, required: boolean): DeriveWireDerived => ({
    name,
    type: DERIVE_WIRE_STRING_USE,
    required,
    derivedFrom: { derivation: CACHE_ETAG, from: [pipelineCopy(origin)] },
  });
  const entityTag = derived(DERIVE_WIRE_ETAG, true);

  for (const response of deriveWireSuccessResponses(route))
    if (!response.headers.some(isVersionTag))
      deriveWireAddResponseHeader(route, response, entityTag, undefined, scope);

  deriveWireAddParam(route, "header", derived("If-None-Match", false), scope);

  const responses = route.operation.responses ?? [];
  const notModified: IrWriter.Response = {
    status: NOT_MODIFIED,
    shape: "empty",
    headers: [
      {
        name: entityTag.name,
        type: pipelineCopy(entityTag.type),
        required: true,
        derivedFrom: pipelineCopy(entityTag.derivedFrom),
      },
    ],
    derivedFrom: pipelineCopy(entityTag.derivedFrom),
  };
  const after = responses.findIndex((response) => response.status > NOT_MODIFIED);

  responses.splice(after === -1 ? responses.length : after, 0, notModified);
}

function reportMethod(
  route: DeriveWireRoute,
  setting: InheritedEntry,
  scope: DeriveWireScope,
): void {
  scope.reporter.error({
    rule: "cache-method",
    message: `operation '${route.id}' is a ${route.operation.method?.toUpperCase()} route and declares cache, which applies to GET routes only`,
    fix: "Remove cache from the route, or declare it on a GET route.",
    pointer: setting.origin.pointer,
  });
}

function reportFamily(setting: InheritedEntry, what: string, scope: DeriveWireScope): void {
  scope.reporter.error({
    rule: "cache-family",
    message: `cache ${what}`,
    fix: "Name a family declared in conventions.cache.families with its maxAge, or freshness: never.",
    pointer: setting.origin.pointer,
  });
}

function reportSensitive(
  route: DeriveWireRoute,
  setting: InheritedEntry,
  found: { readonly family: string; readonly sensitive: DeriveWireSensitiveField },
  scope: DeriveWireScope,
): void {
  const { family, sensitive } = found;

  scope.reporter.error({
    rule: "cache-sensitive",
    message: `operation '${route.id}' answers the sensitive field '${sensitive.schema}.${sensitive.property}', so its cache family '${family}' would store it`,
    fix: "Drop cache or sensitive, or write freshness: never.",
    pointer: setting.origin.pointer,
    related: [
      { pointer: route.node.pointer, message: "the route" },
      { pointer: sensitive.origin.pointer, message: "the sensitive field" },
    ],
  });
}
