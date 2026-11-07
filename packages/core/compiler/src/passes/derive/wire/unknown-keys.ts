import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy, pipelineIsJsonObject } from "../../../pipeline/seam.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The api's unknown-key policy for body inputs (`input.unknownKeys`, ADR 0006 section 5): a
// `conventions.input.unknownKeys` other than `refuse` is written on every `ref` body input that sets none. It is
// the last writer of the field: a policy on the use (tree.nodes) and a signed identity's (access) win. The
// authoring schema admits `refuse`, `{ ignore: <reason> }` or `{ keep: <reason> }` only.

const INPUT_UNKNOWN_KEYS = "input.unknownKeys";

const POLICIES = ["ignore", "keep"] as const;

/** The policy the conventions set, or undefined for `refuse`. */
export function deriveWireUnknownKeysPolicy(
  scope: DeriveWireScope,
): IrWriter.UnknownKeys | undefined {
  const reading = scope.context.conventions.get("input.unknownKeys");

  if (reading === undefined || !pipelineIsJsonObject(reading.value)) return undefined;

  const value = reading.value;
  const policy = POLICIES.find((name) => Object.hasOwn(value, name));
  const reason = policy === undefined ? undefined : value[policy];

  if (policy === undefined || typeof reason !== "string" || reading.origin === undefined)
    throw new Error(
      `conventions.input.unknownKeys is ${JSON.stringify(value)}, which the authoring schema refuses`,
    );

  return {
    policy,
    reason,
    derivedFrom: { derivation: INPUT_UNKNOWN_KEYS, from: [pipelineCopy(reading.origin)] },
  };
}

/** Writes the api's policy on the route's body input when its use sets none. */
export function deriveWireUnknownKeys(
  route: DeriveWireRoute,
  policy: IrWriter.UnknownKeys | undefined,
): void {
  const schema = route.operation.input?.schema;

  if (policy === undefined || schema?.kind !== "ref" || schema.unknownKeys !== undefined) return;

  schema.unknownKeys = pipelineCopy(policy);
}
