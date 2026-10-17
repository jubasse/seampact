import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type DraftOperationInput,
  type PassReadonly,
  pipelineCanonical,
  pipelineCopy,
  pipelinePointerBelow,
} from "../../../pipeline/seam.js";
import { treeNodesFieldWire } from "../../tree/nodes/index.js";
import type { AccessRightsCatalogues } from "./catalogues.js";
import { accessRightsOriginOf } from "./read.js";
import type { AccessRightsReporter } from "./report.js";
import type { AccessRightsRoute } from "./routes.js";
import type { AccessRightsContext } from "./schema-use.js";

// Rule proofs (FR-41, ADR 0004 section 13): each value a required rule reads from the request. A proof read in a
// header is a derived header parameter; one read in the body is an element of `input.proofs`. Both come in
// requirement order, one per name: two requirements reading one name with one schema share an element whose
// `derivedFrom.from` lists both. A route without `input` that a body proof applies to gets a proof-only input on
// the core empty schema. A signed identity's route must end with an input, since its signature covers the raw body.

const PROOF_DERIVATION = "rule.proof";
const UNKNOWN_KEYS_DERIVATION = "identity.unknownKeys";
const PROOF_ONLY_MEDIA = "application/json";
const EMPTY_BODY_SCHEMA = "ApiEmptyBody";
const FIELD_MEDIA: readonly IrWriter.InputMediaType[] = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

/** What one route's proofs need besides the catalogues. */
export interface AccessRightsProofsInput {
  readonly route: AccessRightsRoute;
  /** The route's checked requirements, in order. */
  readonly requires: readonly IrWriter.Requirement[];
  readonly schemas: PassReadonly<DraftIR["schemas"]>;
  readonly identities: PassReadonly<DraftIR["identities"]>;
}

export interface AccessRightsProofs {
  /** The header proofs, as derived header parameters, in requirement order. */
  readonly headers: IrWriter.Param[];
  /** The body proofs of a declared input, in requirement order; empty when there is none. */
  readonly proofs: IrWriter.InputProof[];
  /** The proof-only input this half writes where tree.nodes wrote none, its proofs included. */
  readonly createdInput?: DraftOperationInput;
}

/** One requirement reading a proof, with the origins its element lists. */
interface ProofUse {
  readonly rule: string;
  readonly proof: PassReadonly<IrWriter.RuleProof>;
  /** Where the requirement applies: its own origin, or the first origin of a pack derivation. */
  readonly usePointer: string;
  readonly proofPointer: string;
  readonly from: IrWriter.Origin[];
}

/** The proofs of a route's requirements; each proof error of the route is reported. */
export function accessRightsProofs(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  input: AccessRightsProofsInput,
): AccessRightsProofs {
  const uses = proofUses(context, catalogues, input.requires);
  const headers = sharedByName(reporter, input.route, uses, "header").map(headerParamOf);
  const bodyUses = sharedByName(reporter, input.route, uses, "body");
  const declared = input.route.operation.input;
  const identity = signedIdentityOf(input);

  if (bodyUses.length === 0) {
    if (declared === undefined && identity !== undefined)
      reportSignedWithoutInput(reporter, input.route, identity);

    return { headers, proofs: [] };
  }

  if (declared === undefined)
    return { headers, proofs: [], ...createdInput(reporter, input, bodyUses, identity) };

  if (!fitsDeclaredInput(reporter, input, declared, bodyUses)) return { headers, proofs: [] };

  const fieldMedia = FIELD_MEDIA.includes(declared.media);

  return {
    headers,
    proofs: bodyUses.map((use) => ({
      ...inputProofOf(use),
      ...(fieldMedia ? { wire: proofWire(context, use) } : {}),
    })),
  };
}

function proofUses(
  context: AccessRightsContext,
  catalogues: AccessRightsCatalogues,
  requires: readonly IrWriter.Requirement[],
): ProofUse[] {
  const uses: ProofUse[] = [];

  for (const requirement of requires) {
    if (requirement.kind !== "rule") continue;

    const proof = catalogues.rules.get(requirement.rule)?.proof;

    if (proof === undefined) continue;

    const origins = requirementOrigins(requirement);
    const proofPointer = pipelinePointerBelow("/rules", requirement.rule, "proof");
    const [first] = origins;

    if (first === undefined)
      throw new Error(
        `access.rights built a requirement on rule '${requirement.rule}' with no origin`,
      );
    uses.push({
      rule: requirement.rule,
      proof,
      usePointer: first.pointer,
      proofPointer,
      from: [...origins, accessRightsOriginOf(context, proofPointer)],
    });
  }

  return uses;
}

// A written requirement has its origin; a pack-derived one the origins of its derivation, the pack entry first.
const requirementOrigins = (requirement: IrWriter.Requirement): IrWriter.Origin[] =>
  requirement.origin !== undefined
    ? [pipelineCopy(requirement.origin)]
    : (requirement.derivedFrom?.from ?? []).map((origin) => pipelineCopy(origin));

// Header names are case-insensitive (RFC 9110 section 5.1); a body name is a JSON member name.
const nameKey = (placement: IrWriter.ProofPlacement, name: string): string =>
  placement === "header" ? name.toLowerCase() : name;

/**
 * The uses of one placement merged by name, in requirement order: a later use with the first one's schema adds
 * its origins to it; one with another schema is an error naming both, and adds nothing.
 */
function sharedByName(
  reporter: AccessRightsReporter,
  route: AccessRightsRoute,
  uses: readonly ProofUse[],
  placement: IrWriter.ProofPlacement,
): ProofUse[] {
  const byName = new Map<string, ProofUse>();

  for (const use of uses) {
    if (use.proof.in !== placement) continue;

    const key = nameKey(placement, use.proof.name);
    const first = byName.get(key);

    if (first === undefined) {
      byName.set(key, { ...use, from: [...use.from] });
      continue;
    }

    if (pipelineCanonical(first.proof.schema) !== pipelineCanonical(use.proof.schema)) {
      reportSchemaClash(reporter, route, first, use);
      continue;
    }

    const listed = new Set(first.from.map((origin) => pipelineCanonical(origin)));

    for (const origin of use.from)
      if (!listed.has(pipelineCanonical(origin))) first.from.push(origin);
  }

  return [...byName.values()];
}

function reportSchemaClash(
  reporter: AccessRightsReporter,
  route: AccessRightsRoute,
  first: ProofUse,
  later: ProofUse,
): void {
  reporter.error({
    rule: "proof-name",
    message: `rules '${first.rule}' and '${later.rule}' read the ${later.proof.in} proof '${later.proof.name}' on route '${route.id}' with different schemas`,
    fix: "give one of the proofs another name, or the same schema",
    pointer: later.usePointer,
    related: [
      { pointer: later.proofPointer, message: "this proof is declared here" },
      { pointer: first.usePointer, message: "the first requirement reading that name" },
      { pointer: first.proofPointer, message: "whose proof is declared here" },
    ],
  });
}

const derivedFromOf = (use: ProofUse): IrWriter.DerivedFrom => ({
  derivation: PROOF_DERIVATION,
  from: use.from.map((origin) => pipelineCopy(origin)),
});

const headerParamOf = (use: ProofUse): IrWriter.Param => ({
  name: use.proof.name,
  type: pipelineCopy(use.proof.schema),
  required: true,
  derivedFrom: derivedFromOf(use),
});

const inputProofOf = (use: ProofUse): IrWriter.InputProof => ({
  name: use.proof.name,
  schema: pipelineCopy(use.proof.schema),
  derivedFrom: derivedFromOf(use),
});

// A form or multipart proof is sent as a field of its type use is; tree.schemas answers the proof's schema
// position, as it does a form field's (ADR 0004 section 13).
const proofWire = (context: AccessRightsContext, use: ProofUse): IrWriter.FieldWire =>
  treeNodesFieldWire(
    pipelinePointerBelow(use.proofPointer, "schema"),
    pipelineCopy(use.proof.schema),
    context.treeSchemas,
  );

function signedIdentityOf(
  input: AccessRightsProofsInput,
): PassReadonly<IrWriter.SignedIdentity> | undefined {
  const name = input.route.identity;

  if (name === undefined || !Object.hasOwn(input.identities, name)) return undefined;

  const identity = input.identities[name];

  return identity?.kind === "signed" ? identity : undefined;
}

function reportSignedWithoutInput(
  reporter: AccessRightsReporter,
  route: AccessRightsRoute,
  identity: PassReadonly<IrWriter.SignedIdentity>,
): void {
  reporter.error({
    rule: "signed-input",
    message: `route '${route.id}' runs under signed identity '${identity.id}', whose signature covers the raw body, and has no input`,
    fix: "declare `input`",
    pointer: route.node.pointer,
  });
}

// A body proof needs a body: a `get` has none, nor a `delete` that declares no input (ADR 0002 section 9).
function createdInput(
  reporter: AccessRightsReporter,
  input: AccessRightsProofsInput,
  uses: readonly ProofUse[],
  identity: PassReadonly<IrWriter.SignedIdentity> | undefined,
): Pick<AccessRightsProofs, "createdInput"> {
  const route = input.route;
  const method = route.operation.method;
  const [first] = uses;

  if (first === undefined) throw new Error("a proof-only input is created for a body proof");

  if (method === "get" || method === "delete") {
    for (const use of uses)
      reporter.error({
        rule: "proof-input",
        message: `rule '${use.rule}' reads its proof '${use.proof.name}' from the body of route '${route.id}', a ${method} without input`,
        fix:
          method === "get"
            ? "read the proof in a header, or require the rule on a route with a body"
            : "declare the route's `input`, read the proof in a header, or require the rule elsewhere",
        pointer: use.usePointer,
        related: [{ pointer: use.proofPointer, message: "the proof is declared here" }],
      });

    return {};
  }

  const [origin] = first.from;

  if (origin === undefined) throw new Error("a proof use lists its requirement's origin first");
  const unknownKeys = identity === undefined ? undefined : identityUnknownKeys(identity);

  return {
    createdInput: {
      media: PROOF_ONLY_MEDIA,
      schema: {
        kind: "ref",
        schema: EMPTY_BODY_SCHEMA,
        ...(unknownKeys === undefined ? {} : { unknownKeys }),
      },
      origin: pipelineCopy(origin),
      rawBody: identity !== undefined,
      proofs: uses.map(inputProofOf),
    },
  };
}

// The identity's policy, copied with its derivation as access.identity writes it on a declared input (M-1 of
// ADR 0004 section 13), so every `ref` input of a signed route carries it.
function identityUnknownKeys(
  identity: PassReadonly<IrWriter.SignedIdentity>,
): IrWriter.UnknownKeys | undefined {
  const policy = identity.unknownKeys;

  if (policy === undefined) return undefined;

  return {
    policy: policy.policy,
    reason: policy.reason,
    derivedFrom: { derivation: UNKNOWN_KEYS_DERIVATION, from: [pipelineCopy(identity.origin)] },
  };
}

/**
 * Whether body proofs fit a declared input: a `ref` use of an object schema whose properties and form fields
 * bear none of the proofs' names. Each misfit is reported.
 */
function fitsDeclaredInput(
  reporter: AccessRightsReporter,
  input: AccessRightsProofsInput,
  declared: PassReadonly<DraftOperationInput>,
  uses: readonly ProofUse[],
): boolean {
  const route = input.route;
  const schema = declared.schema;
  const object =
    schema.kind === "ref" && Object.hasOwn(input.schemas, schema.schema)
      ? input.schemas[schema.schema]
      : undefined;

  if (object?.kind !== "object") {
    const [first] = uses;

    if (first === undefined) throw new Error("a declared input is checked for a body proof");
    reporter.error({
      rule: "proof-input",
      message: `rule '${first.rule}' reads its proof '${first.proof.name}' from the body of route '${route.id}', whose input is no named object schema`,
      fix: "make the route's input an object schema, or read the proof in a header",
      pointer: first.usePointer,
      related: [
        { pointer: declared.origin.pointer, message: "the route's input is declared here" },
      ],
    });

    return false;
  }

  let fits = true;

  for (const use of uses) {
    const property = object.properties.find((candidate) => candidate.name === use.proof.name);
    const field = declared.fields?.find((candidate) => candidate.name === use.proof.name);

    if (property === undefined && field === undefined) continue;

    fits = false;
    reporter.error({
      rule: "proof-name",
      message: `rule '${use.rule}' reads its proof '${use.proof.name}' from the body of route '${route.id}', whose input already has a field '${use.proof.name}'`,
      fix: "rename the input's field, or give the proof another name",
      pointer: use.usePointer,
      related: [
        { pointer: use.proofPointer, message: "the proof is declared here" },
        {
          pointer: property?.origin.pointer ?? declared.origin.pointer,
          message: "the input's field is declared here",
        },
      ],
    });
  }

  return fits;
}
