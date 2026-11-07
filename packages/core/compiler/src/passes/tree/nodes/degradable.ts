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

  const header = site.context.conventions.get("degradedHeader")?.value;
  const paths = written.map((path, index) => {
    if (typeof path !== "string")
      throw new Error(`${pointer}/${index} is not a string, which validate guarantees`);

    return path;
  });
  const success = responses.find(
    (response) => response.status < 300 && response.body !== undefined,
  );

  paths.forEach((path, index) => {
    checkPath(site, path, `${pointer}/${index}`, success?.body, typeof header === "string");
  });

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

// The success data a path reaches into; a route with no success body has none to leave out. Where the header is
// written, its value lists the path as written, so a name it cannot carry is refused.
function checkPath(
  site: TreeNodesSite,
  path: string,
  pointer: string,
  body: IrWriter.TypeUse | undefined,
  headerWritten: boolean,
): void {
  const segments = path.split(".");
  const fault = body === undefined ? NO_PROPERTY : pathFault(site, segments, body);

  if (fault !== undefined) {
    reportPath(site, pointer, {
      message: `The degradable path ${path} of ${site.operationId} ${fault}; only an optional part can be left out.`,
      fix: "Name an optional object property of the success data, or make the property optional.",
    });

    return;
  }

  if (headerWritten && segments.some(nameUnfitForHeader))
    reportPath(site, pointer, {
      message: `The degradable path ${path} of ${site.operationId} names a property the degraded header cannot carry: a name may hold no comma, no character outside visible ASCII and space, and no leading or trailing space.`,
      fix: "Rename the property, or leave it out of degradable.",
    });
}

const NO_PROPERTY = "names no property of the success data";

// The header value is a comma-separated list (RFC 9110 section 5.6.1) of the paths as written.
const HEADER_UNSAFE_NAME = /[^\x20-\x7e]|,|^ | $/;

const nameUnfitForHeader = (name: string): boolean => HEADER_UNSAFE_NAME.test(name);

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

function reportPath(
  site: TreeNodesSite,
  pointer: string,
  { message, fix }: { readonly message: string; readonly fix: string },
): void {
  site.context.report(
    treeNodesError({
      rule: "degradable-path",
      origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? site.node.origin),
      message,
      fix,
    }),
  );
}
