import type { IrWriter } from "@seampact/spec/ir";
import { type DraftOperation, pipelineCopy } from "../../../pipeline/seam.js";
import type { AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope } from "./access.js";
import { accessIdentityIsParameterLocation, accessIdentityRouteHasParameter } from "./params.js";
import { accessIdentityPointer } from "./read.js";

// The facts of a signed route that its identity decides (ADR 0013, ADR 0006 sections 3 and 5): the raw body and the
// identity's unknown-key policy of its input (`signed.identity`, `identity.unknownKeys`), and the signature key
// source every route of a signed identity must have.

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

  if (name === undefined || !accessIdentityIsParameterLocation(source.in))
    throw new Error(
      `signature scheme '${scheme.id}' reads its key from an unnamed or ${source.in} source`,
    );

  if (accessIdentityRouteHasParameter(route.operation, source.in, name)) return;
  scope.reporter.error({
    rule: "signature-key-source",
    message: `route '${route.id}' under signed identity '${identity.id}' has no ${source.in} parameter '${name}', which signature scheme '${scheme.id}' reads its key id from`,
    fix: "Declare the parameter on the route (a path placeholder, a query field or a request header), or read the key from a source every route of the identity has.",
    pointer: route.node.pointer,
    related: [
      {
        pointer: accessIdentityPointer("", "schemes", scheme.id, "key", "from"),
        message: "the key source",
      },
    ],
  });
}
