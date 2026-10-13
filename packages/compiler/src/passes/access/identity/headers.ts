import type { IrWriter } from "@seampact/spec/ir";
import type { PassContextOf } from "../../../pipeline/seam.js";
import {
  type AccessIdentityRawObject,
  accessIdentityEntries,
  accessIdentityMember,
  accessIdentityPointer,
  accessIdentityString,
} from "./read.js";
import type { AccessIdentityProblem, AccessIdentityReporter } from "./report.js";
import { accessIdentitySchemaUse } from "./schema-use.js";

// The `headers` catalogue (FR-28, ADR 0002 section 9): identity header declarations by semantic, `name` and `in`
// for every semantic but `versionToken`, which declares `response` and `request` instead (the authoring schema
// refuses the other pair), and the schema of a declaration from the schema service.

type Context = PassContextOf<"access.identity">;

const HEADER_SEMANTICS: readonly IrWriter.HeaderSemantic[] = [
  "deadline",
  "traceContext",
  "actorSurface",
  "versionToken",
];

const isHeaderSemantic = (text: string | undefined): text is IrWriter.HeaderSemantic =>
  HEADER_SEMANTICS.some((semantic) => semantic === text);

/** A header declaration with what its uses need: whether a schema is written and the direction it is read in. */
export interface AccessIdentityHeader {
  declaration: IrWriter.HeaderDecl;
  pointer: string;
  /** Whether the declaration writes a `schema`, answered by the schema service or not. */
  schemaWritten: boolean;
  /** The direction of the header's schema: its `in` side, input for a `versionToken` (input and output). */
  direction: IrWriter.Direction;
}

/** The identity headers of the api, by id, in written order; a declaration with an error is left out. */
export function accessIdentityHeaders(
  context: Context,
  reporter: AccessIdentityReporter,
): Map<string, AccessIdentityHeader> {
  const headers = new Map<string, AccessIdentityHeader>();

  for (const [id, raw] of accessIdentityEntries(context.raw.merged, "headers")) {
    const pointer = accessIdentityPointer("", "headers", id);
    const header = headerOf(id, pointer, raw, context, reporter);
    if (header !== undefined) headers.set(id, header);
  }

  return headers;
}

function headerOf(
  id: string,
  pointer: string,
  raw: AccessIdentityRawObject,
  context: Context,
  reporter: AccessIdentityReporter,
): AccessIdentityHeader | undefined {
  const semantic = accessIdentityString(raw, "semantic");
  const origin = context.origin(pointer);
  // The authoring schema requires a known semantic.
  if (!isHeaderSemantic(semantic) || origin === undefined)
    throw new Error(`the identity header at ${pointer} has no known semantic or no origin`);

  const sides = semantic === "versionToken" ? versionTokenSides(raw) : namedSides(raw);
  if (sides.missing.length > 0) {
    reporter.error({
      rule: "header-declaration",
      message: `${semantic} header '${id}' has no ${sides.missing.map((member) => `'${member}'`).join(", ")}`,
      fix:
        semantic === "versionToken"
          ? "Declare the 'response' header that carries the token and the 'request' header compared on use."
          : "Declare the header's 'name' and the message it travels in, 'in: request' or 'in: response'.",
      pointer,
    });
    return undefined;
  }

  const direction: IrWriter.Direction = sides.in === "response" ? "output" : "input";
  const schemaPointer = accessIdentityPointer(pointer, "schema");
  const schemaWritten = accessIdentityMember(raw, "schema") !== undefined;
  const schema = schemaWritten
    ? accessIdentitySchemaUse(context, schemaPointer, direction)
    : undefined;

  if (semantic === "actorSurface" && schema !== undefined && schema.kind !== "enum") {
    reporter.error(
      accessIdentityActorSurfaceRefusal("header-declaration", id, schemaPointer, schema.kind),
    );
    return undefined;
  }

  const declaration: IrWriter.HeaderDecl = {
    id,
    semantic,
    ...sides.members,
    ...(schema === undefined ? {} : { schema }),
    origin,
  };
  return { declaration, pointer, schemaWritten, direction };
}

interface HeaderSides {
  members: Pick<IrWriter.HeaderDecl, "name" | "in" | "response" | "request">;
  in?: IrWriter.HeaderSide;
  missing: string[];
}

function namedSides(raw: AccessIdentityRawObject): HeaderSides {
  const name = accessIdentityString(raw, "name");
  const side = accessIdentityString(raw, "in");
  const headerSide: IrWriter.HeaderSide | undefined =
    side === "request" || side === "response" ? side : undefined;
  const missing = [
    ...(name === undefined ? ["name"] : []),
    ...(headerSide === undefined ? ["in"] : []),
  ];

  return {
    members: {
      ...(name === undefined ? {} : { name }),
      ...(headerSide === undefined ? {} : { in: headerSide }),
    },
    ...(headerSide === undefined ? {} : { in: headerSide }),
    missing,
  };
}

function versionTokenSides(raw: AccessIdentityRawObject): HeaderSides {
  const response = accessIdentityString(raw, "response");
  const request = accessIdentityString(raw, "request");
  const missing = [
    ...(response === undefined ? ["response"] : []),
    ...(request === undefined ? ["request"] : []),
  ];

  return {
    members: {
      ...(response === undefined ? {} : { response }),
      ...(request === undefined ? {} : { request }),
    },
    missing,
  };
}

/** The refusal of an actorSurface header schema that is no enum (ADR 0002 section 9: a strict enum). */
export const accessIdentityActorSurfaceRefusal = (
  rule: "header-declaration" | "header-use",
  header: string,
  pointer: string,
  kind: string,
): AccessIdentityProblem => ({
  rule,
  message: `actorSurface header '${header}' has a schema of kind ${kind}; an actor surface is a strict enum`,
  fix: "Name the enum of the product's surfaces as the header's schema, such as 'schema: { enum: Surface }'.",
  pointer,
});
