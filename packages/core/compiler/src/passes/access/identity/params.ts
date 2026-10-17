import type { DraftOperation } from "../../../pipeline/seam.js";
import type { AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope } from "./access.js";
import { accessIdentityPointer } from "./read.js";

// The parameters a route declares, as access reads them: a binding's or a signature key's source among them, and a
// query scheme's parameter, which is never a declared query field (ADR 0002 section 9).

export type AccessIdentityParameterLocation = "path" | "query" | "header";

const PARAMETER_LOCATIONS: readonly string[] = ["path", "query", "header"];

/** Whether a value source's location is one a route declares parameters in. */
export const accessIdentityIsParameterLocation = (
  location: string,
): location is AccessIdentityParameterLocation => PARAMETER_LOCATIONS.includes(location);

/** Whether the operation declares the parameter; header names compare without case (RFC 9110). */
export function accessIdentityRouteHasParameter(
  operation: DraftOperation,
  location: AccessIdentityParameterLocation,
  name: string,
): boolean {
  const params = operation.params;
  if (params === undefined) return false;

  switch (location) {
    case "path":
      return params.path.some((param) => param.name === name);
    case "query":
      return params.query.some((param) => param.name === name);
    case "header":
      return params.header.some((param) => param.name.toLowerCase() === name.toLowerCase());
  }
}

/** Reports a declared query field named as a query scheme's parameter the route accepts. */
export function accessIdentityCheckQuerySchemes(
  route: AccessIdentityRoute,
  resolved: AccessIdentityResolved,
  scope: AccessIdentityScope,
): void {
  const access = resolved.access;
  if (access === undefined || access.kind === "public") return;

  for (const id of access.schemes) {
    const scheme = scope.built.schemes.get(id);
    if (
      scheme?.kind !== "query" ||
      !accessIdentityRouteHasParameter(route.operation, "query", scheme.name)
    )
      continue;

    scope.reporter.error({
      rule: "scheme-query-field",
      message: `route '${route.id}' declares query field '${scheme.name}', which query scheme '${id}' it accepts reads as its credential`,
      fix: "Rename the query field or the scheme's parameter: a query scheme's parameter is never a declared query field.",
      pointer: route.node.pointer,
      related: [
        {
          pointer: accessIdentityPointer("", "schemes", id, "name"),
          message: "the scheme's parameter",
        },
      ],
    });
  }
}
