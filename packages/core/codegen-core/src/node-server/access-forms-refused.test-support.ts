import { type ContractIR, type IdentityAccess, isKnownVariant } from "@seampact/spec/ir";
import type { GenerateOutcome, GenerateRequest, Target } from "../target.js";
import { readGoldenIr } from "./reference-project.test-support.js";

/** An access form 1.0 refuses by name: how to put it in the golden tasks api, and the code the refusal carries. */
export interface RefusedAccessForm {
  readonly title: string;
  readonly code: string;
  readonly change: (ir: ContractIR) => void;
}

type Operation = ContractIR["operations"][number];

const ACCESS_ORIGIN = { layer: "api", pointer: "/access" } as const;

// The first guarded operation of the tasks api.
function guardedOperationOf(ir: ContractIR): Operation {
  const operation = ir.operations.find((candidate) => candidate.access.kind === "identity");

  if (operation === undefined) throw new Error("the golden tasks api has no guarded operation");

  return operation;
}

function identityAccessOf(operation: Operation): IdentityAccess {
  const { access } = operation;

  if (!isKnownVariant("Access", access) || access.kind !== "identity")
    throw new Error("the operation is not guarded");

  return access;
}

/** The forms CHK-004, 006, 019, 020 and 094 wait on: each fails generation on every server target. */
export const ACCESS_FORMS_REFUSED_BY_ONE_ZERO: readonly RefusedAccessForm[] = [
  {
    title: "a principal requirement",
    code: "principalRequires.unsupported",
    change: (ir) => {
      guardedOperationOf(ir).principalRequires = [{ field: "verified", origin: ACCESS_ORIGIN }];
    },
  },
  {
    title: "a principal binding",
    code: "bindings.unsupported",
    change: (ir) => {
      guardedOperationOf(ir).bindings = [
        {
          from: { in: "body", name: "ownerId" },
          to: { in: "principal", name: "profileId" },
          origin: ACCESS_ORIGIN,
        },
      ];
    },
  },
  {
    title: "a scope resolved by the application",
    code: "scope.source.unsupported",
    change: (ir) => {
      const [scope] = ir.operations.find((operation) => operation.scopes.length > 0)?.scopes ?? [];

      if (scope === undefined) throw new Error("the golden tasks api has no scoped operation");

      scope.source = { in: "resolver" };
    },
  },
  {
    title: "optional authentication",
    code: "access.optional.unsupported",
    change: (ir) => {
      const operation = guardedOperationOf(ir);
      const access = identityAccessOf(operation);

      operation.access = {
        kind: "optional",
        identity: access.identity,
        schemes: access.schemes,
        reason: "Previews open it.",
        onRefused: "anonymous",
        origin: ACCESS_ORIGIN,
      };
    },
  },
  {
    title: "a principal with variants",
    code: "principal.variants.unsupported",
    change: (ir) => {
      const identity = ir.identities[identityAccessOf(guardedOperationOf(ir)).identity];

      if (identity === undefined || !("principal" in identity))
        throw new Error("the operation has no credential identity");

      identity.principal = { kind: "variants", variants: {} };
    },
  },
];

/** The outcome of generating the golden tasks api with [form] in it. */
export async function generateWithAccessForm(
  serverTarget: Target,
  form: RefusedAccessForm,
  where: { readonly links: GenerateRequest["links"]; readonly outputDirectory: string },
): Promise<GenerateOutcome> {
  const ir = readGoldenIr("tasks");

  form.change(ir);

  return serverTarget.generate({
    ir,
    options: {},
    links: where.links,
    outputDirectory: where.outputDirectory,
    artefacts: new Set(["boundary", "index"]),
  });
}
