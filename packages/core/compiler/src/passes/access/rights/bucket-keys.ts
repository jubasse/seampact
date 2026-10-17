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
// `body.<field>` key names a required, non-null, non-sensitive string or integer field of the route's input, never
// one of its body proofs, and a `principal.<field>` key needs a principal, which a public or optional-auth route may
// not have. A key naming a body proof already refused on the route is that proof's error only.

/** What one route's bucket uses need besides the catalogues. */
export interface AccessRightsBucketKeysInput {
  readonly route: AccessRightsRoute;
  readonly requires: readonly IrWriter.Requirement[];
  /** The route's input as it ends: declared, created for its proofs, or none. */
  readonly input?: PassReadonly<DraftOperationInput>;
  readonly proofs: readonly IrWriter.InputProof[];
  /** The names of the route's body proofs refused while building them. */
  readonly refusedProofs: readonly string[];
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

interface KeyProblem {
  readonly why: string;
  readonly fix: string;
}

function keyProblem(
  input: AccessRightsBucketKeysInput,
  source: PassReadonly<IrWriter.ValueSource>,
): KeyProblem | undefined {
  if (source.in === "principal" && input.route.access !== "identity")
    return {
      why: `${input.route.access === "public" ? "a public" : "an optional-auth"} route, where the principal may be null`,
      fix: "count the bucket by a source every caller has (address, a body field), or require it on an identified route",
    };

  if (source.in !== "body" || source.name === undefined) return undefined;

  return bodyKeyProblem(input, source.name);
}

function bodyKeyProblem(input: AccessRightsBucketKeysInput, name: string): KeyProblem | undefined {
  const property = inputProperty(input, name);

  if (property === undefined) return proofKeyProblem(input, name);

  if (property.sensitive)
    return {
      why: `whose input field '${name}' is sensitive`,
      fix: "count a field that is not sensitive, or another source",
    };

  if (property.optional || property.nullable)
    return {
      why: `whose input field '${name}' may be absent or null`,
      fix: "make the field required and non-null, or count another source",
    };

  const type = property.type;

  if (type.kind === "scalar" && COUNTABLE_TYPES.includes(type.type)) return undefined;

  return {
    why: `whose input field '${name}' is no string or integer`,
    fix: "count a string or integer field of the input",
  };
}

// A body key that is no input field: a body proof, sensitive by definition, or nothing the body carries.
function proofKeyProblem(input: AccessRightsBucketKeysInput, name: string): KeyProblem | undefined {
  if (input.refusedProofs.includes(name)) return undefined;

  if (input.proofs.some((proof) => proof.name === name))
    return {
      why: `whose body field '${name}' is a rule proof, which is sensitive`,
      fix: "count an input field that is not sensitive, or another source",
    };

  return {
    why: `whose input has no field '${name}'`,
    fix: "count a field the input declares, or require the bucket on a route whose input has it",
  };
}

// A property of the route's object input schema.
function inputProperty(
  input: AccessRightsBucketKeysInput,
  name: string,
): PassReadonly<IrWriter.Property> | undefined {
  const schema = input.input?.schema;
  const object =
    schema?.kind === "ref" && Object.hasOwn(input.schemas, schema.schema)
      ? input.schemas[schema.schema]
      : undefined;

  return object?.kind === "object"
    ? object.properties.find((candidate) => candidate.name === name)
    : undefined;
}
