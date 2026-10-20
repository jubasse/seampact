import { below, type IrLocation } from "@seampact/codegen-core";
import type { Operation, Param } from "@seampact/spec/ir";
import { type EmitContext, writeExtension } from "./emit-context.js";
import { type JsonObject, setDefined } from "./json-value.js";
import { pagingLimitDefault } from "./paging.js";
import { typeUseSchema, wireValue } from "./schemas.js";

// The path, query and header parameters of an operation. Credential and CSRF parameters, in a header or the query,
// are stated by the security schemes, never as parameters (the IR holds no cookie parameter); an identity header
// carries its `x-seampact-semantic`.

const SCHEME_DERIVATIONS: readonly string[] = ["identity.authenticate", "csrf.cookieWrite"];
const BRACKETS_SUFFIX = "[]";

export function operationParameters(
  context: EmitContext,
  operation: Operation,
  location: IrLocation,
): JsonObject[] {
  const parameters: JsonObject[] = [];
  const places = [
    ["path", operation.params.path],
    ["query", operation.params.query],
    ["header", operation.params.header],
  ] as const;

  for (const [place, params] of places) {
    params.forEach((param, index) => {
      if (writtenBySecurity(param)) return;

      parameters.push(
        parameterObject(context, operation, place, param, below(location, "params", place, index)),
      );
    });
  }

  return parameters;
}

function writtenBySecurity(param: Param): boolean {
  return (
    param.derivedFrom !== undefined && SCHEME_DERIVATIONS.includes(param.derivedFrom.derivation)
  );
}

function parameterObject(
  context: EmitContext,
  operation: Operation,
  place: "path" | "query" | "header",
  param: Param,
  location: IrLocation,
): JsonObject {
  const brackets = param.wire?.brackets === true;
  const parameter: JsonObject = {
    name: brackets ? `${param.name}${BRACKETS_SUFFIX}` : param.name,
    in: place,
    required: param.required,
  };

  if (param.wire !== undefined) {
    parameter.style = param.wire.style;
    parameter.explode = param.wire.explode;
  }

  const schema = typeUseSchema(context, param.type, "shared", below(location, "type"));
  const defaultValue =
    param.default === undefined
      ? pagingLimitDefault(context, operation, place, param.name)
      : wireValue(context, param.type, param.default);

  setDefined(schema, "default", defaultValue);
  parameter.schema = schema;

  if (place === "header") {
    const semantic = identityHeaderSemantic(context, param.name);

    if (semantic !== undefined) writeExtension(context, parameter, "semantic", semantic);
  }

  return parameter;
}

/** The semantic of the identity header a request header carries, matched by name without regard to case. */
function identityHeaderSemantic(context: EmitContext, headerName: string): string | undefined {
  const lowerName = headerName.toLowerCase();

  for (const header of Object.values(context.ir.headers)) {
    const requestName = header.semantic === "versionToken" ? header.request : header.name;

    if (requestName?.toLowerCase() === lowerName && header.in !== "response")
      return header.semantic;
  }

  return undefined;
}
