import type { IrWriter } from "@seampact/spec/ir";
import { type ConventionReading, pipelineCopy } from "../../../pipeline/seam.js";
import { DERIVE_WIRE_LINK, DERIVE_WIRE_STRING_USE, deriveWireAddSuccessHeader } from "./params.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The lifecycle members derived from settings tree.nodes wrote (ADR 0002 section 10, ADR 0006 section 5).
// `deprecation.headers`: a deprecated operation answers every success with the deprecation and sunset headers, and
// the successor `Link` (relation `conventions.deprecation.successorRel`) when it names one; tree.nodes checked that
// the successor is an operation of the api. `upstream.maturity`: an operation with no stated maturity takes its
// owning service's (the first of `upstream`), else the api's, located at the api's `maturity`, or at the api
// itself when its maturity is the default. Each deprecation header's `from` is the deprecation, then the
// convention that names it, so a collision of one header is located at its own convention; each carries its
// semantic, which tells the renamed headers apart.

const DEPRECATION = "deprecation.headers";

interface DeprecationHeader {
  readonly name: string;
  readonly semantic: IrWriter.ResponseHeaderSemantic;
  readonly naming: ConventionReading | undefined;
}

/** Writes the deprecation, sunset and successor `Link` response headers of a deprecated operation. */
export function deriveWireDeprecation(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const deprecated = route.operation.deprecated;

  if (deprecated === undefined) return;

  const conventions = scope.context.conventions;
  const header = conventions.get("deprecation.header");
  const sunsetHeader = conventions.get("deprecation.sunsetHeader");
  const headers: DeprecationHeader[] = [
    { name: textOf(header), semantic: "deprecation", naming: header },
    { name: textOf(sunsetHeader), semantic: "sunset", naming: sunsetHeader },
  ];

  if (deprecated.successor !== undefined)
    headers.push({
      name: DERIVE_WIRE_LINK,
      semantic: "successorLink",
      naming: conventions.get("deprecation.successorRel"),
    });

  for (const { name, semantic, naming } of headers)
    deriveWireAddSuccessHeader(
      route,
      {
        name,
        type: DERIVE_WIRE_STRING_USE,
        required: true,
        derivedFrom: {
          derivation: DEPRECATION,
          from: [
            pipelineCopy(deprecated.origin),
            ...(naming?.origin === undefined ? [] : [pipelineCopy(naming.origin)]),
          ],
        },
      },
      semantic,
      scope,
    );
}

/** Writes the derived `maturity` of an operation that states none. */
export function deriveWireMaturity(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const operation = route.operation;

  if (operation.maturity !== undefined) return;

  const owner = operation.upstream?.[0];

  if (owner !== undefined) {
    const services = scope.draft.services;
    const service = Object.hasOwn(services, owner) ? services[owner] : undefined;

    if (service === undefined)
      throw new Error(
        `tree.nodes wrote upstream service '${owner}' on '${route.id}', which is no service`,
      );

    operation.maturity = {
      level: service.maturity,
      source: "upstream",
      origin: pipelineCopy(service.origin),
    };

    return;
  }

  const api = scope.draft.api;

  if (api === undefined) throw new Error("tree.nodes wrote no api");

  const origin = scope.context.origin("/api/maturity") ?? api.origin;

  operation.maturity = { level: api.maturity, source: "api", origin: pipelineCopy(origin) };
}

function textOf(reading: { readonly value: unknown } | undefined): string {
  if (typeof reading?.value !== "string")
    throw new Error("a conventions.deprecation header name has no text, which its default gives");

  return reading.value;
}
