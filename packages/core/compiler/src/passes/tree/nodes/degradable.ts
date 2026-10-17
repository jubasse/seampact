import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import type { TreeNodesSite } from "./fields.js";
import { treeNodesIsObject, treeNodesMember, treeNodesObjectOf, treeNodesSetting } from "./raw.js";

// `degradable` (ADR 0002 section 10, SCN-085): paths of optional properties of the success data, each a dotted
// path through object properties. A degraded response says which parts it left out: in the format's `degraded`
// meta field, else in `conventions.degradedHeader`, which is then required (ADR 0006 section 7).

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

  if (
    !formatFillsDegraded(site, format) &&
    site.context.conventions.get("degradedHeader") === undefined
  )
    site.context.report(
      treeNodesError({
        rule: "degradable-header",
        origin: treeNodesNodeOrigin(origin),
        message: `The route ${site.operationId} is degradable, but its format ${format} has no degraded meta field and conventions.degradedHeader is unset.`,
        fix: "Set conventions.degradedHeader, or use a format with a meta field filled with degraded.",
      }),
    );

  return { paths, origin: pipelineCopy(origin) };
}

function formatFillsDegraded(site: TreeNodesSite, format: string): boolean {
  const meta = treeNodesMember(treeNodesMember(site.context.raw.merged.formats, format), "meta");

  return (
    treeNodesIsObject(meta) &&
    Object.values(meta).some((field) => treeNodesMember(field, "fill") === DEGRADED_FILL)
  );
}

// Each segment names a property of the object reached so far; the last one must be optional.
function checkPath(
  site: TreeNodesSite,
  path: string,
  pointer: string,
  body: IrWriter.TypeUse | undefined,
): void {
  let use = body;
  let property: IrWriter.Property | undefined;

  for (const segment of path.split(".")) {
    const schema = treeNodesObjectOf(site.draft, use?.kind === "array" ? use.items : use);

    property = schema?.properties.find((candidate) => candidate.name === segment);

    if (property === undefined) {
      reportPath(site, path, pointer, "names no property of the success data");

      return;
    }

    use = property.type;
  }

  if (property?.optional === false) reportPath(site, path, pointer, "names a required property");
}

function reportPath(site: TreeNodesSite, path: string, pointer: string, why: string): void {
  site.context.report(
    treeNodesError({
      rule: "degradable-path",
      origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? site.node.origin),
      message: `The degradable path ${path} of ${site.operationId} ${why}; only an optional part can be left out.`,
      fix: "Name an optional property of the success data, or make the property optional.",
    }),
  );
}
