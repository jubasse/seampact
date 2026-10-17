import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type DraftOperationInput,
  type PassReadonly,
  pipelinePointerBelow,
} from "../../../pipeline/seam.js";
import type { AccessRightsCatalogues } from "./catalogues.js";
import type { AccessRightsReporter } from "./report.js";
import type { AccessRightsRoute } from "./routes.js";
import { accessRightsSourceText } from "./source.js";

// The key sources of each bucket a route counts in, checked at that use (ADR 0002 section 9, "Buckets"): a
// `body.<field>` key names a string or integer field of the route's input or one of its body proofs, and a
// `principal.<field>` key needs a principal, which a public or optional-auth route may not have.

/** What one route's bucket uses need besides the catalogues. */
export interface AccessRightsBucketKeysInput {
  readonly route: AccessRightsRoute;
  readonly requires: readonly IrWriter.Requirement[];
  /** The route's input as it ends: declared, created for its proofs, or none. */
  readonly input?: PassReadonly<DraftOperationInput>;
  readonly proofs: readonly IrWriter.InputProof[];
  readonly schemas: PassReadonly<DraftIR["schemas"]>;
}

const COUNTABLE_TYPES: readonly IrWriter.ScalarType[] = ["string", "integer"];

/** Reports each key of a bucket the route counts in that the route cannot fill. */
export function accessRightsCheckBucketKeys(
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  input: AccessRightsBucketKeysInput,
): void {
  for (const requirement of input.requires) {
    if (requirement.kind !== "rule" || requirement.bucket === undefined) continue;

    const bucket = catalogues.buckets.get(requirement.bucket);
    const usePointer = requirement.origin?.pointer ?? requirement.derivedFrom?.from[0]?.pointer;

    if (bucket === undefined || usePointer === undefined)
      throw new Error(
        `access.rights built a requirement counting in bucket '${requirement.bucket}' it cannot place`,
      );

    for (const [index, source] of bucket.key.entries()) {
      const problem = keyProblem(input, source);

      if (problem === undefined) continue;

      reporter.error({
        rule: "bucket-key",
        message: `bucket '${bucket.id}' counts ${accessRightsSourceText(source)} on route '${input.route.id}', ${problem.why}`,
        fix: problem.fix,
        pointer: usePointer,
        distinctBy: accessRightsSourceText(source),
        related: [
          {
            pointer: pipelinePointerBelow("/buckets", bucket.id, "key", index),
            message: "the key is declared here",
          },
        ],
      });
    }
  }
}

function keyProblem(
  input: AccessRightsBucketKeysInput,
  source: PassReadonly<IrWriter.ValueSource>,
): { readonly why: string; readonly fix: string } | undefined {
  if (source.in === "principal" && input.route.access !== "identity")
    return {
      why: `${input.route.access === "public" ? "a public" : "an optional-auth"} route, where the principal may be null`,
      fix: "count the bucket by a source every caller has (address, a body field), or require it on an identified route",
    };

  if (source.in !== "body" || source.name === undefined) return undefined;

  const type = bodyFieldType(input, source.name);

  if (type === undefined)
    return {
      why: `whose input has no field '${source.name}'`,
      fix: "count a field the input declares, or require the bucket on a route whose input has it",
    };

  if (type.kind === "scalar" && COUNTABLE_TYPES.includes(type.type)) return undefined;

  return {
    why: `whose input field '${source.name}' is no string or integer`,
    fix: "count a string or integer field of the input",
  };
}

// A field of the route's body: a property of its object input schema, else one of its body proofs.
function bodyFieldType(
  input: AccessRightsBucketKeysInput,
  name: string,
): PassReadonly<IrWriter.TypeUse> | undefined {
  const schema = input.input?.schema;
  const object =
    schema?.kind === "ref" && Object.hasOwn(input.schemas, schema.schema)
      ? input.schemas[schema.schema]
      : undefined;
  const property =
    object?.kind === "object"
      ? object.properties.find((candidate) => candidate.name === name)
      : undefined;

  return property?.type ?? input.proofs.find((proof) => proof.name === name)?.schema;
}
