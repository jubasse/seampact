import { pipelinePointerBelow } from "../../../pipeline/seam.js";
import type { AccessRightsCatalogues } from "./catalogues.js";
import { accessRightsString } from "./read.js";
import type { AccessRightsReporter } from "./report.js";
import type { AccessRightsRoute } from "./routes.js";

// `filteredBy` (SCN-068, ADR 0002 section 10): the right the application applies to a list's query, written on the
// route itself (it is not inherited) and checked against the rights catalogue. Nothing enforces it.

/** The route's `filteredBy` right, undefined when not written or refused. */
export function accessRightsFilteredBy(
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  route: AccessRightsRoute,
): string | undefined {
  const right = accessRightsString(route.node.settings, "filteredBy");

  if (right === undefined || catalogues.rights.has(right)) return right;

  if (!catalogues.declared.rights.has(right))
    reporter.error({
      rule: "filtered-by",
      message: `route '${route.id}' is filtered by right '${right}', which the rights catalogue does not declare`,
      fix: "declare the right in 'rights', or name a declared one",
      pointer: pipelinePointerBelow(route.node.pointer, "filteredBy"),
    });

  return undefined;
}
