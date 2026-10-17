import type { IrWriter } from "@seampact/spec/ir";
import { type DraftOperation, pipelineCopy } from "../../../pipeline/seam.js";
import type { AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope } from "./access.js";
import { accessIdentityPointer } from "./read.js";

// The facts of a route's input and parameters that its access decides (ADR 0013, ADR 0006 sections 3 and 5): the raw
// body and the identity's unknown-key policy of a signed route (`signed.identity`, `identity.unknownKeys`), the
// signature key source every route of a signed identity must have, and a query scheme's parameter, which is never a
// declared query field (ADR 0002 section 9).

const UNKNOWN_KEYS_DERIVATION = "identity.unknownKeys";

/** The input facts this half writes on an operation's declared input, read before any is written. */
export interface AccessIdentityInputFacts {
  rawBody: boolean;
  unknownKeys?: IrWriter.UnknownKeys;
}

/**
 * The raw body of a declared input, true on a signed identity's route and false elsewhere, and on a signed route the
 * identity's unknown-key policy for a `ref` input whose use sets none (the only use carrying `unknownKeys`).
 */
export function accessIdentityInputFacts(
  operation: DraftOperation,
  identity: IrWriter.KnownIdentity | undefined,
): AccessIdentityInputFacts | undefined {
  const input = operation.input;
  if (input === undefined) return undefined;
  if (identity?.kind !== "signed") return { rawBody: false };

  const policy = identity.unknownKeys;
  const schema = input.schema;
  if (policy === undefined || schema.kind !== "ref" || schema.unknownKeys !== undefined)
    return { rawBody: true };

  return {
    rawBody: true,
    unknownKeys: {
      policy: policy.policy,
      reason: policy.reason,
      derivedFrom: { derivation: UNKNOWN_KEYS_DERIVATION, from: [pipelineCopy(identity.origin)] },
    },
  };
}

/** Reports a signed route without the parameter its signature scheme reads the key id from (ADR 0013). */
export function accessIdentityCheckSignatureKey(
  route: AccessIdentityRoute,
  resolved: AccessIdentityResolved,
  scope: AccessIdentityScope,
): void {
  const identity = resolved.identity;
  if (identity?.kind !== "signed") return;

  // A scheme left out of the catalogue for an error of its own is already reported.
  const scheme = scope.built.schemes.get(identity.signed);
  if (scheme?.kind !== "signature") return;
  const key = scheme.signature.key;
  if (key?.kind !== "from") return;

  // The authoring schema reads a key from a named path, query or header source.
  const source = key.from;
  const name = source.name;
  if (name === undefined || !isParameterLocation(source.in))
    throw new Error(`signature scheme '${scheme.id}' reads its key from an unnamed or ${source.in} source`);
  if (accessIdentityRouteHasParameter(route.operation, source.in, name)) return;
  scope.reporter.error({
    rule: "signature-key-source",
    message: `route '${route.id}' under signed identity '${identity.id}' has no ${source.in} parameter '${name}', which signature scheme '${scheme.id}' reads its key id from`,
    fix: "Declare the parameter on the route (a path placeholder, a query field or a request header), or read the key from a source every route of the identity has.",
    pointer: route.node.pointer,
    related: [
      { pointer: accessIdentityPointer("", "schemes", scheme.id, "key", "from"), message: "the key source" },
    ],
  });
}

/** Reports a declared query field named as a query scheme's parameter the route accepts. */
export function accessIdentityCheckQuerySchemes(
  route: AccessIdentityRoute,
  resolved: AccessIdentityResolved,
  scope: AccessIdentityScope,
): void {
  if (resolved.access.kind === "public") return;

  for (const id of resolved.access.schemes) {
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
        { pointer: accessIdentityPointer("", "schemes", id, "name"), message: "the scheme's parameter" },
      ],
    });
  }
}

type ParameterLocation = "path" | "query" | "header";

const PARAMETER_LOCATIONS: readonly string[] = ["path", "query", "header"];

const isParameterLocation = (location: string): location is ParameterLocation =>
  PARAMETER_LOCATIONS.includes(location);

/** Whether the operation declares the parameter; header names compare without case (RFC 9110). */
export function accessIdentityRouteHasParameter(
  operation: DraftOperation,
  location: ParameterLocation,
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
