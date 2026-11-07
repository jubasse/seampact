import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import {
  DERIVE_WIRE_STRING_USE,
  type DeriveWireDerived,
  deriveWireAddResponseHeader,
} from "./params.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The headers of the bodies beyond JSON (A39, ADR 0002 section 7, ADR 0006 section 5); their `binary` and
// `redirect` shapes are tree.nodes'. `response.download`: a response whose body is a file answers the required
// `Content-Type`, one of the file's media, and the optional `Content-Disposition`, written when the handler names a
// file. `redirect.location`: a 301, 302, 303, 307 or 308 answers the required `Location`, a `uri-reference`.

const DOWNLOAD = "response.download";

const REDIRECT = "redirect.location";

const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];

const URI_REFERENCE_USE: IrWriter.ScalarTypeUse = Object.freeze({
  kind: "scalar",
  type: "string",
  format: "uri-reference",
  refinements: Object.freeze({}),
});

/** Writes the download and redirect headers of the operation's responses. */
export function deriveWireBodyHeaders(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const responses = route.operation.responses ?? [];

  for (const response of responses)
    if (response.body?.kind === "file") {
      const from = originOf(route, response);

      add(
        route,
        response,
        { name: "Content-Type", required: true, from, derivation: DOWNLOAD },
        scope,
      );
      add(
        route,
        response,
        { name: "Content-Disposition", required: false, from, derivation: DOWNLOAD },
        scope,
      );
    }

  for (const response of responses)
    if (REDIRECT_STATUSES.includes(response.status))
      add(
        route,
        response,
        {
          name: "Location",
          required: true,
          from: originOf(route, response),
          derivation: REDIRECT,
          type: URI_REFERENCE_USE,
        },
        scope,
      );
}

interface BodyHeader {
  readonly name: string;
  readonly required: boolean;
  readonly from: IrWriter.Origin;
  readonly derivation: string;
  readonly type?: IrWriter.TypeUse;
}

function add(
  route: DeriveWireRoute,
  response: IrWriter.Response,
  header: BodyHeader,
  scope: DeriveWireScope,
): void {
  const derived: DeriveWireDerived = {
    name: header.name,
    type: header.type ?? DERIVE_WIRE_STRING_USE,
    required: header.required,
    derivedFrom: { derivation: header.derivation, from: [pipelineCopy(header.from)] },
  };

  deriveWireAddResponseHeader(route, response, derived, undefined, scope);
}

// The response as written, else the route that declares it as its output.
function originOf(route: DeriveWireRoute, response: IrWriter.Response): IrWriter.Origin {
  const origin = response.origin ?? route.operation.origin;

  if (origin === undefined)
    throw new Error(`tree.nodes wrote no origin on operation '${route.id}'`);

  return origin;
}
