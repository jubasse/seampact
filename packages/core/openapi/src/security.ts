import { below, type IrLocation } from "@seampact/codegen-core";
import {
  isKnownVariant,
  type KnownScheme,
  type Operation,
  type SchemeKey,
  type SignatureVerify,
} from "@seampact/spec/ir";
import {
  type EmitContext,
  reasonValue,
  refuseInconsistent,
  refuseUnknown,
  writeExtension,
} from "./emit-context.js";
import { compareCodeUnits, copyJsonValue, type JsonObject, setDefined } from "./json-value.js";
import { valueSourceText } from "./ir-text.js";

// The security rows of ADR 0004 section 12: `schemes` as `components.securitySchemes`, and an operation's access,
// CSRF check or exemption as its `security` list and the `x-seampact-access` and `x-seampact-csrf` extensions.

/** Writes `security`, `x-seampact-access` and `x-seampact-csrf` on an operation object. */
export function writeOperationSecurity(
  context: EmitContext,
  operation: Operation,
  target: JsonObject,
  location: IrLocation,
): void {
  const access = operation.access;

  if (!isKnownVariant("Access", access)) {
    refuseUnknown(context, below(location, "access", "kind"), access.kind);

    return;
  }

  switch (access.kind) {
    case "public":
      target.security = [];
      writeExtension(context, target, "access", { public: reasonValue(context, access.reason) });
      break;
    case "identity":
      target.security = requirementsOf(context, operation, access.schemes, location);
      writeExtension(context, target, "access", { identity: access.identity });
      break;
    case "optional": {
      const schemes = [
        ...access.schemes,
        ...optionalReadSchemes(context, operation, access.identity),
      ];

      target.security = [...requirementsOf(context, operation, schemes, location), {}];
      writeExtension(context, target, "access", {
        identity: access.identity,
        optionalAuth: reasonValue(context, access.reason),
        onRefused: access.onRefused,
      });
      break;
    }
  }

  writeCsrf(context, operation, target, location);
}

function optionalReadSchemes(
  context: EmitContext,
  operation: Operation,
  identityId: string,
): string[] {
  const identity = context.ir.identities[identityId];

  if (!operation.safe || identity === undefined || !isKnownVariant("Identity", identity)) return [];

  return identity.kind === "credential" ? identity.schemes.optionalRead : [];
}

// One requirement object per scheme; a cookie scheme on a CSRF-checked write holds its CSRF header scheme too,
// since every scheme of one object is required.
function requirementsOf(
  context: EmitContext,
  operation: Operation,
  schemeIds: readonly string[],
  location: IrLocation,
): JsonObject[] {
  const unique = [...new Set(schemeIds)];

  return unique.map((schemeId) => {
    const requirement: JsonObject = { [useScheme(context, schemeId, location)]: [] };
    const scheme = context.ir.schemes[schemeId];
    const csrfChecked = operation.csrf !== undefined && operation.csrf.kind === "derived";

    if (scheme !== undefined && scheme.kind === "cookie" && "csrf" in scheme && csrfChecked) {
      if (scheme.csrf !== undefined) requirement[useScheme(context, scheme.csrf, location)] = [];
    }

    return requirement;
  });
}

function useScheme(context: EmitContext, schemeId: string, location: IrLocation): string {
  if (context.ir.schemes[schemeId] === undefined) {
    refuseInconsistent(
      context,
      "scheme.missing",
      `The scheme '${schemeId}' is not declared`,
      location,
    );
  }

  context.securitySchemes.add(schemeId);

  return schemeId;
}

function writeCsrf(
  context: EmitContext,
  operation: Operation,
  target: JsonObject,
  location: IrLocation,
): void {
  const csrf = operation.csrf;

  if (csrf === undefined) return;

  if (!isKnownVariant("Csrf", csrf)) {
    refuseUnknown(context, below(location, "csrf", "kind"), csrf.kind);

    return;
  }

  if (csrf.kind === "exempt") {
    writeExtension(context, target, "csrf", { exempt: reasonValue(context, csrf.reason) });
  }
}

/** `components.securitySchemes`: the schemes the document's operations name, sorted by id. */
export function securitySchemesComponent(context: EmitContext): JsonObject {
  const component: JsonObject = {};
  const ids = [...context.securitySchemes].sort(compareCodeUnits);

  for (const id of ids) {
    const scheme = context.ir.schemes[id];
    const location = below({ member: "" }, "schemes", id);

    // A missing scheme was refused where an operation named it.
    if (scheme === undefined) continue;

    if (!isKnownVariant("Scheme", scheme)) {
      refuseUnknown(context, below(location, "kind"), scheme.kind);
      continue;
    }

    component[id] = securityScheme(context, scheme, location);
  }

  return component;
}

function securityScheme(
  context: EmitContext,
  scheme: KnownScheme,
  location: IrLocation,
): JsonObject {
  switch (scheme.kind) {
    case "cookie":
      return { type: "apiKey", in: "cookie", name: scheme.name };
    case "header":
      return { type: "apiKey", in: "header", name: scheme.name };
    case "query":
      return { type: "apiKey", in: "query", name: scheme.name };
    case "basic":
      return { type: "http", scheme: "basic" };
    case "bearer":
      return bearerScheme(scheme.bearer);
    case "signature":
      return signatureScheme(context, scheme.name, scheme.signature, below(location, "signature"));
  }
}

function bearerScheme(facts: Extract<KnownScheme, { kind: "bearer" }>["bearer"]): JsonObject {
  if (facts?.oauth2 !== undefined) {
    return { type: "oauth2", flows: copyJsonValue(facts.oauth2.flows) };
  }

  if (facts?.openIdConnectUrl !== undefined) {
    return { type: "openIdConnect", openIdConnectUrl: facts.openIdConnectUrl };
  }

  const scheme: JsonObject = { type: "http", scheme: "bearer" };

  setDefined(scheme, "bearerFormat", facts?.format);

  return scheme;
}

function signatureScheme(
  context: EmitContext,
  headerName: string | undefined,
  signature: SignatureVerify,
  location: IrLocation,
): JsonObject {
  const scheme: JsonObject = { type: "apiKey", in: "header" };

  if (headerName === undefined) {
    refuseInconsistent(
      context,
      "signature.header",
      "A signature scheme without its header",
      location,
    );
  } else {
    scheme.name = headerName;
  }

  if (!isKnownVariant("SignatureVerify", signature)) {
    refuseUnknown(context, below(location, "verify"), signature.verify);

    return scheme;
  }

  if (signature.verify === "template") {
    const value: JsonObject = {
      verify: signature.verify,
      format: signature.format,
      algorithm: signature.algorithm,
      payload: signature.payload,
      encoding: signature.encoding,
    };

    setDefined(value, "toleranceMs", signature.toleranceMs);
    setDefined(value, "key", schemeKeyValue(context, signature.key, below(location, "key")));
    writeExtension(context, scheme, "signature", value);

    return scheme;
  }

  const value: JsonObject = { verify: signature.verify, headers: [...signature.headers] };

  if (signature.key !== undefined) {
    setDefined(value, "key", schemeKeyValue(context, signature.key, below(location, "key")));
  }

  writeExtension(context, scheme, "signature", value);

  return scheme;
}

function schemeKeyValue(
  context: EmitContext,
  key: SchemeKey,
  location: IrLocation,
): JsonObject | undefined {
  if (!isKnownVariant("SchemeKey", key)) {
    refuseUnknown(context, below(location, "kind"), key.kind);

    return undefined;
  }

  return key.kind === "value" ? { value: key.value } : { from: valueSourceText(key.from) };
}
