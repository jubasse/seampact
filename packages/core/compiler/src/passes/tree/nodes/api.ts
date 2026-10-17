import type { IrWriter, Origin } from "@seampact/spec/ir";
import { splitName } from "@seampact/spec/naming";
import { type DraftIR, type PassContextOf, pipelineCopy } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import { treeNodesIsObject, treeNodesMember, treeNodesPointer } from "./raw.js";

// The api member (ADR 0002 sections 5 and 6, ADR 0004 section 2): the api file's settings, its surfaces with their
// resolved prefixes, and the path version. A prefix holds `{version}`, or gets `/v{version}` in front of it, unless
// its path version is `none`, when it is used as written; under `prefix` a literal version segment is refused, since
// the version is held once, on the api.

type TreeNodesContext = PassContextOf<"tree.nodes">;

type Json = Parameters<typeof treeNodesMember>[0];

const VERSION_PLACEHOLDER = "{version}";
const DEFAULT_VERSIONED_PREFIX = "/v{version}";
const LITERAL_VERSION_SEGMENT = /^v[0-9]+$/;
const PLACEHOLDER = /\{[^{}]+\}/g;

const API_KINDS: readonly IrWriter.ApiKind[] = ["product", "service"];
const DEFAULT_API_KIND: IrWriter.ApiKind = "product";
const MATURITIES: readonly IrWriter.Maturity[] = ["experimental", "provisional", "stable"];
// The grammar gives `api.maturity` no default; an api that states none promises the least (see the report).
const DEFAULT_MATURITY: IrWriter.Maturity = "experimental";
const COMPAT_POLICIES: readonly IrWriter.CompatPolicy[] = ["additive-only", "none"];
const DEFAULT_COMPAT: IrWriter.CompatPolicy = "none";
const PATH_VERSION_MODES: readonly IrWriter.PathVersionMode[] = ["prefix", "none"];
const INTERNAL_POLICIES: readonly IrWriter.InternalPolicy[] = ["include", "exclude"];
const DEFAULT_INTERNAL: IrWriter.InternalPolicy = "include";
const API_ROLES: readonly IrWriter.ApiRole[] = ["gateway"];

// Names of the api and its surfaces take the role the after-tree fixture writes.
const NAME_ROLE = "schema";

const oneOf = <T extends string>(value: Json | undefined, allowed: readonly T[]): T | undefined =>
  allowed.find((candidate) => candidate === value);

const textOf = (value: Json | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

/** The resolved prefix of each surface, by surface name. */
export type TreeNodesSurfacePrefixes = ReadonlyMap<string, string>;

/** Writes `api` to the draft and returns each surface's resolved prefix, which every path starts with. */
export function treeNodesApi(draft: DraftIR, context: TreeNodesContext): TreeNodesSurfacePrefixes {
  const written = context.raw.merged.api;
  const origin = requiredOrigin(context, "/api");
  const versionOrigin = context.origin("/api/version") ?? origin;
  const version = versionOf(treeNodesMember(written, "version"));

  const surfaces = surfacesOf(context, version, versionOrigin);
  const role = oneOf(treeNodesMember(written, "role"), API_ROLES);
  const caller = callerOf(treeNodesMember(written, "caller"));

  draft.api = {
    id: textOf(treeNodesMember(written, "name")) ?? context.raw.name,
    name: {
      segments: splitName(textOf(treeNodesMember(written, "name")) ?? context.raw.name),
      role: NAME_ROLE,
    },
    version,
    kind: oneOf(treeNodesMember(written, "kind"), API_KINDS) ?? DEFAULT_API_KIND,
    pathVersion: pathVersionOf(context, versionOrigin),
    ...(role === undefined ? {} : { role }),
    maturity: oneOf(treeNodesMember(written, "maturity"), MATURITIES) ?? DEFAULT_MATURITY,
    ...(caller === undefined ? {} : { caller }),
    compat: {
      policy:
        oneOf(treeNodesMember(treeNodesMember(written, "compat"), "policy"), COMPAT_POLICIES) ??
        DEFAULT_COMPAT,
    },
    surfaces: Object.fromEntries(surfaces.map(({ id, surface }) => [id, surface])),
    documents: documentsOf(
      treeNodesMember(written, "documents"),
      surfaces.map(({ id }) => id),
    ),
    docs: treeNodesDocs(written),
    extensions: {},
    origin: pipelineCopy(origin),
  };

  return new Map(surfaces.map(({ id, surface }) => [id, surface.prefix]));
}

function requiredOrigin(context: TreeNodesContext, pointer: string): Origin {
  const origin = context.origin(pointer);
  if (origin === undefined) throw new Error(`the raw tree has no origin for ${pointer}`);
  return origin;
}

// An integer version is the path version; a string one a label, allowed only with every surface unversioned.
function versionOf(written: Json | undefined): IrWriter.ApiVersion {
  if (typeof written === "number") return { kind: "path", number: written };
  if (typeof written === "string") return { kind: "label", label: written };
  throw new Error("the api file has no version, which the grammar requires");
}

function pathVersionOf(context: TreeNodesContext, versionOrigin: Origin): IrWriter.PathVersion {
  const reading = context.conventions.get("pathVersion");
  const value = oneOf(reading?.value, PATH_VERSION_MODES);
  if (value === undefined)
    throw new Error(
      `conventions.pathVersion resolves to ${String(reading?.value)}, no mode the grammar admits`,
    );
  return { value, origin: pipelineCopy(reading?.origin ?? versionOrigin) };
}

/** The `summary` and `description` written on a mapping. */
export function treeNodesDocs(written: Json | undefined): IrWriter.Docs {
  const summary = textOf(treeNodesMember(written, "summary"));
  const description = textOf(treeNodesMember(written, "description"));
  return {
    ...(summary === undefined ? {} : { summary }),
    ...(description === undefined ? {} : { description }),
  };
}

function callerOf(written: Json | undefined): IrWriter.ApiCaller | undefined {
  const identity = textOf(treeNodesMember(written, "identity"));
  const right = textOf(treeNodesMember(written, "right"));
  return identity === undefined || right === undefined ? undefined : { identity, right };
}

function documentsOf(
  written: Json | undefined,
  surfaceIds: readonly string[],
): Record<string, IrWriter.ApiDocument> {
  const documents: Record<string, IrWriter.ApiDocument> = {};
  if (!treeNodesIsObject(written)) return documents;

  for (const [id, document] of Object.entries(written)) {
    const listed = treeNodesMember(document, "surfaces");
    const surfaces = Array.isArray(listed)
      ? listed.filter((surface): surface is string => typeof surface === "string")
      : [...surfaceIds];
    const internal =
      oneOf(treeNodesMember(document, "internal"), INTERNAL_POLICIES) ?? DEFAULT_INTERNAL;
    documents[id] = { surfaces, internal };
  }
  return documents;
}

interface SurfaceEntry {
  readonly id: string;
  readonly surface: IrWriter.Surface;
}

function surfacesOf(
  context: TreeNodesContext,
  version: IrWriter.ApiVersion,
  versionOrigin: Origin,
): SurfaceEntry[] {
  const written = context.raw.merged.surfaces;
  if (!treeNodesIsObject(written)) return [];

  const conventionMode = context.conventions.get("pathVersion")?.value;
  const entries: SurfaceEntry[] = [];
  const versionedSurfaces: string[] = [];

  for (const [id, settings] of Object.entries(written)) {
    const pointer = treeNodesPointer("/surfaces", id);
    const origin = requiredOrigin(context, pointer);
    const mode =
      oneOf(treeNodesMember(settings, "pathVersion"), PATH_VERSION_MODES) ??
      oneOf(conventionMode, PATH_VERSION_MODES);
    if (mode === undefined) throw new Error(`the surface ${id} resolves no path version mode`);

    const writtenPrefix = textOf(treeNodesMember(settings, "prefix")) ?? "";
    const prefixOrigin = context.origin(`${pointer}/prefix`) ?? origin;
    checkPrefix({ id, writtenPrefix, mode, version, prefixOrigin }, context);
    if (mode === "prefix") versionedSurfaces.push(id);

    entries.push({
      id,
      surface: {
        name: { segments: splitName(id), role: NAME_ROLE },
        prefix: resolvePrefix(writtenPrefix, mode, version),
        pathVersion: mode,
        origin: pipelineCopy(origin),
      },
    });
  }

  if (version.kind === "label" && versionedSurfaces.length > 0)
    context.report(
      treeNodesError({
        rule: "api-version",
        origin: treeNodesNodeOrigin(versionOrigin),
        message: `The api version ${version.label} is a label, but the surface ${versionedSurfaces.join(", ")} puts a version number in its paths.`,
        fix: "Write an integer version, or set pathVersion: none on every surface (or in conventions).",
      }),
    );
  return entries;
}

interface PrefixSite {
  readonly id: string;
  readonly writtenPrefix: string;
  readonly mode: IrWriter.PathVersionMode;
  readonly version: IrWriter.ApiVersion;
  readonly prefixOrigin: Origin;
}

// `{version}` under `pathVersion: none`, and a literal version segment under `prefix`, are refused (FR-2, SCN-032).
// Under `none` the prefix is used exactly as written, so a third party's `/v1` stays.
function checkPrefix(site: PrefixSite, context: TreeNodesContext): void {
  const origin = treeNodesNodeOrigin(site.prefixOrigin);
  checkPrefixPlaceholders(site, context, origin);
  if (site.mode === "none") {
    if (site.writtenPrefix.includes(VERSION_PLACEHOLDER))
      context.report(
        treeNodesError({
          rule: "path-version",
          origin,
          message: `The prefix ${site.writtenPrefix} of the surface ${site.id} holds {version}, but its pathVersion is none.`,
          fix: "Remove {version} from the prefix, or set pathVersion: prefix.",
        }),
      );
    return;
  }

  const literal = site.writtenPrefix
    .split("/")
    .find((segment) => LITERAL_VERSION_SEGMENT.test(segment));
  if (literal === undefined) return;

  const number = Number(literal.slice(1));
  const mismatch =
    site.version.kind === "path" && site.version.number !== number
      ? `, which differs from the api version ${site.version.number}`
      : "";
  context.report(
    treeNodesError({
      rule: "path-version",
      origin,
      message: `The prefix ${site.writtenPrefix} of the surface ${site.id} holds the literal version segment ${literal}${mismatch}; the version is held once, on the api.`,
      fix: `Write {version} instead of ${literal}.`,
    }),
  );
}

// A prefix's only placeholder is `{version}`: no parameter fills any other, so it would reach the client as written.
function checkPrefixPlaceholders(
  site: PrefixSite,
  context: TreeNodesContext,
  origin: ReturnType<typeof treeNodesNodeOrigin>,
): void {
  const others = [...site.writtenPrefix.matchAll(PLACEHOLDER)]
    .map((match) => match[0])
    .filter((placeholder) => placeholder !== VERSION_PLACEHOLDER);
  for (const placeholder of new Set(others))
    context.report(
      treeNodesError({
        rule: "path-param",
        origin,
        message: `The prefix ${site.writtenPrefix} of the surface ${site.id} holds ${placeholder}, which no parameter fills; a prefix holds only {version}.`,
        fix: `Remove ${placeholder} from the prefix, or move it into a node's path and declare it in pathParams.`,
      }),
    );
}

function resolvePrefix(
  writtenPrefix: string,
  mode: IrWriter.PathVersionMode,
  version: IrWriter.ApiVersion,
): string {
  if (mode === "none") return leadingSlash(trimTrailingSlash(writtenPrefix));

  const template = writtenPrefix.includes(VERSION_PLACEHOLDER)
    ? leadingSlash(writtenPrefix)
    : `${DEFAULT_VERSIONED_PREFIX}${leadingSlash(writtenPrefix)}`;
  const versionText = version.kind === "path" ? String(version.number) : version.label;
  return trimTrailingSlash(template.replaceAll(VERSION_PLACEHOLDER, versionText));
}

const leadingSlash = (path: string): string =>
  path === "" || path.startsWith("/") ? path : `/${path}`;

const trimTrailingSlash = (path: string): string => (path.endsWith("/") ? path.slice(0, -1) : path);
