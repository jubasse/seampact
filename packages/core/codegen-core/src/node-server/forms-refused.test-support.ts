import { type ContractIR, type IdentityAccess, isKnownVariant } from "@seampact/spec/ir";
import type { GenerateOutcome, GenerateRequest, Target } from "../target.js";
import { packIr } from "./live-pages.test-support.js";
import { readGoldenIr } from "./reference-project.test-support.js";

/** A form 1.0 refuses by name: how to put it in the golden tasks api, and the code the refusal carries. */
export interface RefusedForm {
  readonly title: string;
  readonly code: string;
  readonly change: (ir: ContractIR) => void;
}

type Operation = ContractIR["operations"][number];

const ACCESS_ORIGIN = { layer: "api", pointer: "/access" } as const;
const BEARER_SCHEME = "bearer";
const SIGNATURE_SCHEME = "stripeSignature";

// The first guarded operation of the tasks api.
function guardedOperationOf(ir: ContractIR): Operation {
  const operation = ir.operations.find((candidate) => candidate.access.kind === "identity");

  if (operation === undefined) throw new Error("the golden tasks api has no guarded operation");

  return operation;
}

// The user identity's bearer scheme, replaced by a scheme of another kind.
function replaceBearerScheme(
  ir: ContractIR,
  scheme: { kind: "query"; name: string } | { kind: "basic" },
): void {
  const bearer = ir.schemes[BEARER_SCHEME];

  if (bearer === undefined || !isKnownVariant("Scheme", bearer))
    throw new Error("the golden tasks api has no bearer scheme");

  ir.schemes[BEARER_SCHEME] = { id: BEARER_SCHEME, ...scheme, origin: bearer.origin };
}

// The operation of the tasks api with [id], which the golden tasks api must hold.
function operationOf(ir: ContractIR, id: string): Operation {
  const operation = ir.operations.find((candidate) => candidate.id === id);

  if (operation === undefined) throw new Error(`the golden tasks api has no operation '${id}'`);

  return operation;
}

// createTask's JSON body, sent with another media type.
function sendCreateTaskBodyAs(ir: ContractIR, media: string): void {
  const { input } = operationOf(ir, "createTask");

  if (input === undefined) throw new Error("the golden createTask has no body");

  input.media = media;
}

// getTask's success answered with [shape] and no body, as a file download or a redirect is.
function answerGetTaskWith(ir: ContractIR, shape: string, media: string | undefined): void {
  const [success] = operationOf(ir, "getTask").responses;

  if (success === undefined) throw new Error("the golden getTask has no response");

  success.shape = shape;
  delete success.body;

  if (media === undefined) delete success.media;
  else success.media = media;
}

function identityAccessOf(operation: Operation): IdentityAccess {
  const { access } = operation;

  if (!isKnownVariant("Access", access) || access.kind !== "identity")
    throw new Error("the operation is not guarded");

  return access;
}

/** The forms the Node servers refuse by name: each fails generation of the golden tasks api. */
export const FORMS_REFUSED_BY_ONE_ZERO: readonly RefusedForm[] = [
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
  {
    title: "a signature verified by the application",
    code: "signature.application.unsupported",
    change: (ir) => {
      const scheme = ir.schemes[SIGNATURE_SCHEME];

      if (scheme === undefined || !isKnownVariant("Scheme", scheme) || scheme.kind !== "signature")
        throw new Error("the golden tasks api has no signature scheme");

      scheme.signature = { verify: "application", headers: ["Stripe-Signature"] };
    },
  },
  {
    title: "a query API key scheme",
    code: "scheme.query.unsupported",
    change: (ir) => replaceBearerScheme(ir, { kind: "query", name: "api_key" }),
  },
  {
    title: "an HTTP Basic scheme",
    code: "scheme.basic.unsupported",
    change: (ir) => replaceBearerScheme(ir, { kind: "basic" }),
  },
  {
    // `$collection` names its `_embedded` member and `$itemSelf` links each item: page slots not rendered yet.
    title: "the HAL pack's pages",
    code: "paging.response.slot.unsupported",
    change: (ir) => {
      Object.assign(ir, packIr("pack-hal", "tasks"));
    },
  },
  {
    title: "the Spring pack's pair sort",
    code: "paging.sort.style.unsupported",
    change: (ir) => {
      Object.assign(ir, packIr("pack-spring", "tasks"));
    },
  },
  {
    title: "absolute URLs",
    code: "wire.urls.absolute.unsupported",
    change: (ir) => {
      ir.api.wire.urls = "absolute";
    },
  },
  {
    title: "a form body",
    code: "input.media.unsupported",
    change: (ir) => sendCreateTaskBodyAs(ir, "application/x-www-form-urlencoded"),
  },
  {
    title: "a multipart body",
    code: "input.media.unsupported",
    change: (ir) => sendCreateTaskBodyAs(ir, "multipart/form-data"),
  },
  {
    title: "a query list in brackets form",
    code: "query.list.brackets.unsupported",
    change: (ir) => {
      const [sort] = operationOf(ir, "listTasks").params.query.filter(
        (param) => param.wire?.kind === "list",
      );

      if (sort?.wire === undefined) throw new Error("the golden listTasks has no list query param");

      sort.wire.explode = true;
      sort.wire.brackets = true;
    },
  },
  {
    title: "a file download",
    code: "response.shape.unsupported",
    change: (ir) => answerGetTaskWith(ir, "binary", "application/pdf"),
  },
  {
    title: "a redirect response",
    code: "response.shape.unsupported",
    change: (ir) => answerGetTaskWith(ir, "redirect", undefined),
  },
];

/** The outcome of generating the golden tasks api with [form] in it. */
export async function generateWithRefusedForm(
  serverTarget: Target,
  form: RefusedForm,
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
