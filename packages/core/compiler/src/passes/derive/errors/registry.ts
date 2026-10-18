import type { IrWriter } from "@seampact/spec/ir";
import {
  type DerivationRole,
  derivationParamsSchemaId,
  derivationRoles,
} from "../../../derivations/index.js";
import {
  type PassContextOf,
  pipelineCanonical,
  pipelineCopy,
  pipelinePointerBelow,
  pipelineTreeNodes,
} from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import { deriveErrorsIsBaseNature } from "./natures.js";
import {
  type DeriveErrorsRawObject,
  deriveErrorsDocs,
  deriveErrorsEntries,
  deriveErrorsMember,
  deriveErrorsOriginOf,
  deriveErrorsString,
} from "./read.js";
import type { DeriveErrorsReporter } from "./report.js";

// The error registry of ADR 0006 section 6 ("Error declarations on the tree", A35): the declarations of the `errors`
// catalogue (api, base, shared and packs, merged by the loader, which refuses one code in two layers) and of
// `errors` on every tree node, then each default code no layer or node declares, with origin `core`. A code declared
// twice with different definitions is refused naming both places; an attachment of a code nobody declares, and that
// is no default code, is refused naming the code. Authored codes are checked against `conventions.errors.pattern`.

export type DeriveErrorsContext = PassContextOf<"derive.errors">;

/** A code of the registry with the merged raw tree pointer of its declaration (absent for a core default). */
export interface DeriveErrorsRegistered {
  readonly declaration: IrWriter.ErrorDecl;
  readonly pointer?: string;
}

export type DeriveErrorsRegistry = ReadonlyMap<IrWriter.ErrorCode, DeriveErrorsRegistered>;

/** What the registry is built from besides the raw tree. */
export interface DeriveErrorsRegistrySources {
  readonly context: DeriveErrorsContext;
  readonly reporter: DeriveErrorsReporter;
  readonly natures: ReadonlyMap<IrWriter.NatureId, IrWriter.NatureDecl>;
}

// One `errors` entry of the catalogue or of a tree node, at its pointer.
interface ErrorSite {
  readonly code: string;
  readonly pointer: string;
  readonly value: DeriveErrorsRawObject;
}

const ERROR_PATTERN_POINTER = "/conventions/errors/pattern";
const ERROR_EVERY_POINTER = "/conventions/errors/every";

// The members of a node attachment that say where it reaches, not what the code is.
const ATTACHMENT_ONLY_MEMBERS: readonly string[] = ["reach", "for"];

// ADR 0002 section 11: an error without `nature` is `unavailable` for these statuses.
const UNAVAILABLE_STATUSES: readonly number[] = [408, 425, 429, 502, 503, 504];
const FIRST_SERVER_STATUS = 500;

/** The base nature of a status, for a declaration that writes no `nature` (ADR 0002 section 11). */
export function deriveErrorsDefaultNature(status: number): IrWriter.NatureBase {
  if (UNAVAILABLE_STATUSES.includes(status)) return "unavailable";

  return status < FIRST_SERVER_STATUS ? "refused" : "failed";
}

/** The family of a code without `family`: the code up to its first dot, none without a dot (ADR 0002 section 4). */
export function deriveErrorsDefaultFamily(code: string): string | undefined {
  const dot = code.indexOf(".");

  return dot > 0 ? code.slice(0, dot) : undefined;
}

const roleOfDefaultCode = (code: string): DerivationRole | undefined =>
  derivationRoles.find((role) => role.defaultCode === code);

function errorSites(context: DeriveErrorsContext): {
  declarations: ErrorSite[];
  attachments: ErrorSite[];
} {
  const declarations: ErrorSite[] = deriveErrorsEntries(context.raw.merged.errors).map(
    ([code, value]) => ({ code, pointer: pipelinePointerBelow("/errors", code), value }),
  );
  const attachments: ErrorSite[] = [];

  for (const node of pipelineTreeNodes(context.raw))
    for (const [code, value] of deriveErrorsEntries(deriveErrorsMember(node.settings, "errors"))) {
      const site = { code, pointer: pipelinePointerBelow(node.pointer, "errors", code), value };

      if (deriveErrorsMember(value, "status") === undefined) attachments.push(site);
      else declarations.push(site);
    }

  return { declarations, attachments };
}

// What a declaration defines: every member but the attachment's `reach` and `for`, key order aside.
const definitionOf = (site: ErrorSite): string =>
  pipelineCanonical(
    Object.fromEntries(
      Object.entries(site.value).filter(([key]) => !ATTACHMENT_ONLY_MEMBERS.includes(key)),
    ),
  );

function errorPattern(
  context: DeriveErrorsContext,
  reporter: DeriveErrorsReporter,
): RegExp | undefined {
  const written = context.conventions.get("errors.pattern")?.value;

  if (typeof written !== "string") return undefined;

  try {
    return new RegExp(written, "u");
  } catch (error) {
    reporter.error({
      rule: "error-pattern",
      message: `conventions.errors.pattern ${quote(written)} is no regular expression: ${quote(String(error))}`,
      fix: "write a regular expression every error code must match",
      pointer: ERROR_PATTERN_POINTER,
    });

    return undefined;
  }
}

function checkPattern(
  site: ErrorSite,
  pattern: RegExp | undefined,
  reporter: DeriveErrorsReporter,
): void {
  if (pattern === undefined || pattern.test(site.code)) return;

  reporter.error({
    rule: "error-pattern",
    message: `error code ${quote(site.code)} does not match conventions.errors.pattern ${quote(pattern.source)}`,
    fix: "rename the code to match the pattern, or change the pattern",
    pointer: site.pointer,
    related: [{ pointer: ERROR_PATTERN_POINTER, message: "the pattern is set here" }],
  });
}

interface Nature {
  nature: IrWriter.NatureBase;
  natureName?: IrWriter.NatureId;
}

function natureOf(
  site: ErrorSite,
  status: number,
  natures: ReadonlyMap<IrWriter.NatureId, IrWriter.NatureDecl>,
  reporter: DeriveErrorsReporter,
): Nature {
  const written = deriveErrorsString(site.value, "nature");

  if (written === undefined) return { nature: deriveErrorsDefaultNature(status) };

  if (deriveErrorsIsBaseNature(written)) return { nature: written };

  const declared = natures.get(written);

  if (declared !== undefined) return { nature: declared.base, natureName: written };

  const allowed = ["refused", "unavailable", "failed", ...natures.keys()].join(", ");

  reporter.error({
    rule: "error-nature",
    message: `error ${quote(site.code)} has nature ${quote(written)}, which is neither a base nature nor a declared nature; the allowed values are ${allowed}`,
    fix: "use a base nature or declare the nature in 'natures'",
    pointer: pipelinePointerBelow(site.pointer, "nature"),
  });

  return { nature: deriveErrorsDefaultNature(status) };
}

// The params schema of a declaration: the schema its written params compile to, or the core params schema of a
// default code that writes none.
function paramsOf(site: ErrorSite, context: DeriveErrorsContext): IrWriter.SchemaRef | undefined {
  const pointer = pipelinePointerBelow(site.pointer, "params");

  if (deriveErrorsMember(site.value, "params") === undefined) {
    const role = roleOfDefaultCode(site.code);

    return role !== undefined && role.data.length > 0
      ? derivationParamsSchemaId(site.code)
      : undefined;
  }

  const use = context.treeSchemas.typeUse(pointer, "output");

  if (use === undefined)
    throw new Error(`tree.schemas answers no type use at ${pointer}, the params of '${site.code}'`);

  // tree.schemas refuses params that are no object schema (`fields-schema`), and no later half runs then.
  if (use.kind !== "ref")
    throw new Error(`the params at ${pointer} compile to a ${use.kind}, not an object schema`);

  return use.schema;
}

function checkExample(
  site: ErrorSite,
  params: IrWriter.SchemaRef | undefined,
  context: DeriveErrorsContext,
  reporter: DeriveErrorsReporter,
): void {
  const example = deriveErrorsMember(site.value, "example");
  const pointer = pipelinePointerBelow(site.pointer, "example");

  if (example === undefined) return;

  if (params === undefined) {
    reporter.error({
      rule: "error-example",
      message: `error ${quote(site.code)} has an example but no params for it to show`,
      fix: "declare the params, or remove the example",
      pointer,
    });

    return;
  }

  // tree.schemas locates each issue at a value the example holds (a missing member at its object).
  for (const issue of context.treeSchemas.checkExample(example, { kind: "ref", schema: params }))
    reporter.error({
      rule: "error-example",
      message: `the example of error ${quote(site.code)} does not fit its params: ${issue.message}`,
      fix: "correct the example to fit the params",
      pointer: `${pointer}${issue.pointer}`,
    });
}

function declarationOf(site: ErrorSite, sources: DeriveErrorsRegistrySources): IrWriter.ErrorDecl {
  const { context, reporter, natures } = sources;
  const status = deriveErrorsMember(site.value, "status");

  if (typeof status !== "number")
    throw new Error(`the declaration at ${site.pointer} has no numeric status`);

  const family = deriveErrorsString(site.value, "family") ?? deriveErrorsDefaultFamily(site.code);
  const title = deriveErrorsString(site.value, "title");
  const example = deriveErrorsMember(site.value, "example");
  const params = paramsOf(site, context);
  const role = roleOfDefaultCode(site.code);

  checkExample(site, params, context, reporter);

  return {
    code: site.code,
    ...(family === undefined ? {} : { family }),
    ...natureOf(site, status, natures, reporter),
    http: { status },
    ...(params === undefined ? {} : { params }),
    ...(example === undefined ? {} : { example: pipelineCopy(example) }),
    ...(title === undefined ? {} : { title }),
    docs: deriveErrorsDocs(site.value),
    origin: deriveErrorsOriginOf(context, site.pointer),
    ...(role === undefined ? {} : { default: role.role }),
  };
}

function coreDeclarationOf(role: DerivationRole): IrWriter.ErrorDecl {
  const code = role.defaultCode;
  const family = deriveErrorsDefaultFamily(code);

  return {
    code,
    ...(family === undefined ? {} : { family }),
    nature: role.nature,
    http: { status: role.status },
    ...(role.data.length > 0 ? { params: derivationParamsSchemaId(code) } : {}),
    docs: {},
    origin: { layer: "core", pointer: pipelinePointerBelow("/errors", code) },
    default: role.role,
  };
}

// An attached code nobody declares: the node attachments and `conventions.errors.every`.
function checkAttachments(
  attachments: readonly ErrorSite[],
  registry: DeriveErrorsRegistry,
  context: DeriveErrorsContext,
  reporter: DeriveErrorsReporter,
): void {
  const unknown = (code: string, pointer: string): void =>
    reporter.error({
      rule: "error-unknown",
      message: `error code ${quote(code)} is attached here, but no layer or node declares it and it is no default code`,
      fix: `declare ${quote(code)} with a status in 'errors', or attach a declared code`,
      pointer,
    });

  for (const site of attachments) if (!registry.has(site.code)) unknown(site.code, site.pointer);

  const every = context.conventions.get("errors.every")?.value;

  if (!Array.isArray(every)) return;

  every.forEach((code, index) => {
    if (typeof code === "string" && !registry.has(code))
      unknown(code, pipelinePointerBelow(ERROR_EVERY_POINTER, index));
  });
}

/** The api's error registry, every default code included; each problem reported. */
export function deriveErrorsRegistry(sources: DeriveErrorsRegistrySources): DeriveErrorsRegistry {
  const { context, reporter } = sources;
  const registry = new Map<IrWriter.ErrorCode, DeriveErrorsRegistered>();
  const firstSites = new Map<IrWriter.ErrorCode, ErrorSite>();
  const pattern = errorPattern(context, reporter);
  const { declarations, attachments } = errorSites(context);

  for (const site of declarations) {
    const first = firstSites.get(site.code);

    if (first === undefined) {
      checkPattern(site, pattern, reporter);
      firstSites.set(site.code, site);
      registry.set(site.code, {
        declaration: declarationOf(site, sources),
        pointer: site.pointer,
      });
      continue;
    }

    if (definitionOf(first) === definitionOf(site)) continue;

    reporter.error({
      rule: "error-redefined",
      message: `error code ${quote(site.code)} is declared again with a different definition`,
      fix: `attach the code with {} or { example } here, or give one of the two declarations another code`,
      pointer: site.pointer,
      related: [{ pointer: first.pointer, message: `${quote(site.code)} is first declared here` }],
    });
  }

  for (const role of derivationRoles)
    if (!registry.has(role.defaultCode))
      registry.set(role.defaultCode, { declaration: coreDeclarationOf(role) });

  checkAttachments(attachments, registry, context, reporter);

  return registry;
}
