import type { IrWriter } from "@seampact/spec/ir";
import type { ConventionPath } from "../../../pipeline/seam.js";
import type { DeriveWireScope } from "./routes.js";

// The api-wide wire conventions a target acts on (`api.wire`, ADR 0004 section 13): the `int64` wire form, the
// handling of output enums and the URL form, written as the effective conventions set them, core defaults included
// (ADR 0002 section 13). The validate stage refuses any other value, so one here is an internal error.

const INT64_WIRES = ["string", "number"] as const satisfies readonly IrWriter.Int64Wire[];
const OUTPUT_ENUM_FORMS = ["enum", "open"] as const satisfies readonly IrWriter.OutputEnumForm[];
const URL_FORMS = ["relative", "absolute"] as const satisfies readonly IrWriter.UrlForm[];

/** Writes `api.wire` from the effective conventions. */
export function deriveWireApiWire(scope: DeriveWireScope): void {
  const api = scope.draft.api;

  if (api === undefined) throw new Error("derive.wire runs after tree.nodes, which writes the api");

  api.wire = {
    int64: effectiveValue(scope, "int64", INT64_WIRES),
    outputEnums: effectiveValue(scope, "outputEnums", OUTPUT_ENUM_FORMS),
    urls: effectiveValue(scope, "urls", URL_FORMS),
  };
}

function effectiveValue<V extends string>(
  scope: DeriveWireScope,
  path: ConventionPath & keyof IrWriter.ApiWire,
  known: readonly V[],
): V {
  const value = scope.context.conventions.get(path)?.value;
  const effective = known.find((candidate) => candidate === value);

  if (effective === undefined)
    throw new Error(
      `conventions.${path} is ${JSON.stringify(value)}, none of ${known.join(", ")}: the validate stage refuses it`,
    );

  return effective;
}
