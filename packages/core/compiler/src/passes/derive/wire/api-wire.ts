import type { IrWriter } from "@seampact/spec/ir";
import { type ConventionPath, pipelineConventionDefaults } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import type { DeriveWireScope } from "./routes.js";

// The api-wide wire conventions a target acts on (`api.wire`, ADR 0004 section 13): the `int64` wire form, the
// handling of output enums and the URL form, written with their core defaults (ADR 0002 section 13). A layer that
// sets another value is refused by name: no pass writes the wire forms it asks for yet.

const INT64_WIRES = ["string", "number"] as const satisfies readonly IrWriter.Int64Wire[];
const OUTPUT_ENUM_FORMS = ["enum", "open"] as const satisfies readonly IrWriter.OutputEnumForm[];
const URL_FORMS = ["relative", "absolute"] as const satisfies readonly IrWriter.UrlForm[];

/** Writes `api.wire` from the effective conventions, refusing a value other than the core default. */
export function deriveWireApiWire(scope: DeriveWireScope): void {
  const api = scope.draft.api;

  if (api === undefined) throw new Error("derive.wire runs after tree.nodes, which writes the api");

  api.wire = {
    int64: supportedValue(scope, "int64", INT64_WIRES),
    outputEnums: supportedValue(scope, "outputEnums", OUTPUT_ENUM_FORMS),
    urls: supportedValue(scope, "urls", URL_FORMS),
  };
}

// The core default of the convention, reporting a layer that sets another value.
function supportedValue<V extends string>(
  scope: DeriveWireScope,
  path: ConventionPath & keyof IrWriter.ApiWire,
  known: readonly V[],
): V {
  const supported = coreDefaultOf(path, known);
  const reading = scope.context.conventions.get(path);

  if (reading !== undefined && reading.value !== supported)
    scope.reporter.error({
      rule: "wire-convention-unsupported",
      message: `The convention ${path} is ${quote(reading.value)}; the compiler writes only ${quote(supported)} so far.`,
      fix: `Remove conventions.${path}, or set it to ${quote(supported)}.`,
      pointer: `/conventions/${path}`,
    });

  return supported;
}

function coreDefaultOf<V extends string>(path: ConventionPath, known: readonly V[]): V {
  const entry = pipelineConventionDefaults.find((candidate) => candidate.path === path);
  const value = entry !== undefined && "value" in entry ? entry.value : undefined;
  const supported = known.find((candidate) => candidate === value);

  if (supported === undefined)
    throw new Error(`the core default of conventions.${path} is no IR value: ${String(value)}`);

  return supported;
}
