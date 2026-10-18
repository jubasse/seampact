import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import type { TreeNodesSite } from "./fields.js";
import {
  treeNodesDraftSchema,
  treeNodesIsObject,
  treeNodesMember,
  treeNodesSetting,
} from "./raw.js";

// `degradable` (ADR 0002 section 10, SCN-085): paths of optional properties of the success data, each a dotted
// path through object properties, through every variant of a union. A degraded response says which parts it left
// out: in the format's `degraded` meta field, else in `conventions.degradedHeader`, which is then required (ADR 0006
// section 7). The header is written whenever the convention is set, so a target fills both.

const DEGRADED_FILL = "degraded";

/** The degradable paths of an operation, checked against its success body. */
export function treeNodesDegradable(
  site: TreeNodesSite,
  format: string,
  responses: readonly IrWriter.Response[],
): IrWriter.Degradable | undefined {
  const written = treeNodesSetting(site.node, "degradable");
  const pointer = `${site.node.pointer}/degradable`;

  if (!Array.isArray(written)) return undefined;

  const origin = site.context.origin(pointer);

  if (origin === undefined) throw new Error(`the raw tree has no origin for ${pointer}`);

  const paths = written.filter((path) => typeof path === "string");
  const success = responses.find(
    (response) => response.status < 300 && response.body !== undefined,
  );

  paths.forEach((path, index) => {
    checkPath(site, path, `${pointer}/${index}`, success?.body);
  });

  const header = site.context.conventions.get("degradedHeader")?.value;

  if (!formatFillsDegraded(site, format) && typeof header !== "string")
    site.context.report(
      treeNodesError({
        rule: "degradable-header",
        origin: treeNodesNodeOrigin(origin),
        message: `The route ${site.operationId} is degradable, but its format ${format} has no degraded meta field and conventions.degradedHeader is unset.`,
        fix: "Set conventions.degradedHeader, or use a format with a meta field filled with degraded.",
      }),
    );

  return {
    paths,
    ...(typeof header === "string" ? { header } : {}),
    origin: pipelineCopy(origin),
  };
}

function formatFillsDegraded(site: TreeNodesSite, format: string): boolean {
  const meta = treeNodesMember(treeNodesMember(site.context.raw.merged.formats, format), "meta");

  return (
    treeNodesIsObject(meta) &&
    Object.values(meta).some((field) => treeNodesMember(field, "fill") === DEGRADED_FILL)
  );
}

// The success data a path reaches into; a route with no success body has none to leave out.
function checkPath(
  site: TreeNodesSite,
  path: string,
  pointer: string,
  body: IrWriter.TypeUse | undefined,
): void {
  const fault = !PROPERTY_NAME_CHAIN.test(path)
    ? NO_PROPERTY_CHAIN
    : body === undefined
      ? NO_PROPERTY
      : pathFault(site, path.split("."), body);

  if (fault !== undefined) reportPath(site, path, pointer, fault);
}

// Dot-separated property names of letters, digits, `_` and `-`: a path is written into the degraded header, so no
// other character, empty segment or space reaches it.
const PROPERTY_NAME_CHAIN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

const NO_PROPERTY_CHAIN =
  "is no chain of property names (names of letters, digits, _ and - joined by dots)";

const NO_PROPERTY = "names no property of the success data";

// Each segment names a property of the object reached so far, in every variant of a union; the last one must be
// optional. Undefined when the path fits.
function pathFault(
  site: TreeNodesSite,
  segments: readonly string[],
  use: IrWriter.TypeUse,
): string | undefined {
  const reached = use.kind === "array" ? use.items : use;
  const schema =
    reached.kind === "ref" ? treeNodesDraftSchema(site.draft, reached.schema) : undefined;

  if (schema?.kind === "union") return variantsFault(site, segments, schema);

  const [segment, ...rest] = segments;
  const property =
    schema?.kind === "object"
      ? schema.properties.find((candidate) => candidate.name === segment)
      : undefined;

  if (property === undefined) return NO_PROPERTY;

  if (rest.length > 0) return pathFault(site, rest, property.type);

  return property.optional ? undefined : "names a required property";
}

function variantsFault(
  site: TreeNodesSite,
  segments: readonly string[],
  union: IrWriter.UnionSchema,
): string | undefined {
  for (const variant of union.variants) {
    const fault = pathFault(site, segments, { kind: "ref", schema: variant.schema });

    if (fault !== undefined) return `${fault} in the variant ${variant.tag} of ${union.id}`;
  }

  return undefined;
}

function reportPath(site: TreeNodesSite, path: string, pointer: string, why: string): void {
  site.context.report(
    treeNodesError({
      rule: "degradable-path",
      origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? site.node.origin),
      message: `The degradable path ${path} of ${site.operationId} ${why}; only an optional part can be left out.`,
      fix: "Name an optional object property of the success data, or make the property optional.",
    }),
  );
}
