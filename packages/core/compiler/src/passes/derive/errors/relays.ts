import { type ContractIR, checkIrClosedDeclaration, type IrWriter } from "@seampact/spec/ir";
import {
  type DraftOperation,
  type PassReadonly,
  pipelineCanonical,
  pipelineCopy,
  pipelinePointerBelow,
} from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import { TREE_NODES_OPERATION_KIND, treeNodesRelayOrigin } from "../../tree/nodes/index.js";
import type {
  DeriveErrorsContext,
  DeriveErrorsRegistered,
  DeriveErrorsRegistry,
} from "./registry.js";
import type { DeriveErrorsReporter } from "./report.js";
import type { DeriveErrorsRoute } from "./triggers.js";

// Relay codes (ADR 0002 section 7, ADR 0006 sections 3 and 5, row `relay.route`): a relay route copies the domain
// codes of the public operation it relays (node and pack attachments, `notFound`, and the codes that operation
// copied in turn), each with its declaration. The boundary codes it derives itself under its own bindings, and the
// gateway's own (access, api-wide) are not copied. A copied declaration joins this api's `errors` with its origin
// in the public api (`api` naming it), and its contract nature joins `natures`; a code or nature this api already
// declares, or another relay route copied first, must hold the same declaration (everything but the origin), else
// it is refused at the route's `relays`, naming both. A copied declaration's params schema is tree.schemas' to
// copy: one this api lacks is refused. An imported api's declarations are compared only: this compiler narrows no
// imported error declaration yet, so a domain code this api lacks is refused instead of copied.

/** The derivation of a code a relay route copies. */
export const DERIVE_ERRORS_RELAY_DERIVATION = "relay.route";
const PACK_DERIVATION_PREFIX = "pack.";
const DOMAIN_DERIVATIONS: readonly string[] = [
  "member.notFound",
  "owner.caller",
  DERIVE_ERRORS_RELAY_DERIVATION,
  "node.errors",
];

/** A domain code a relay route copies from the public operation. */
export interface DeriveErrorsRelayCode {
  readonly code: IrWriter.ErrorCode;
  readonly from: readonly IrWriter.Origin[];
  readonly example?: unknown;
  readonly roles?: readonly IrWriter.ErrorRoleBinding[];
  /** The public element's origin in its api, for a code attached there. */
  readonly origin?: IrWriter.Origin;
}

/** What the relay routes copy: the declarations and natures this api lacks, and each route's codes by its id. */
export interface DeriveErrorsRelayCopies {
  readonly errors: Map<IrWriter.ErrorCode, DeriveErrorsRegistered>;
  readonly natures: Map<IrWriter.NatureId, IrWriter.NatureDecl>;
  readonly codes: Map<string, DeriveErrorsRelayCode[]>;
}

export interface DeriveErrorsRelaySources {
  readonly context: DeriveErrorsContext;
  readonly reporter: DeriveErrorsReporter;
  readonly registry: DeriveErrorsRegistry;
  readonly natures: ReadonlyMap<IrWriter.NatureId, IrWriter.NatureDecl>;
  readonly schemas: PassReadonly<Record<IrWriter.SchemaId, IrWriter.Schema>>;
}

// A declaration as compared: a closed one, or one an imported IR holds in the open reader types.
type Declaration = { readonly origin?: unknown } & object;

// The public operation and the catalogues its codes are declared in: a workspace api's derived draft, or an
// import, whose declarations this compiler does not narrow.
type PublicSide = {
  readonly api: string;
  readonly operation: PassReadonly<DraftOperation>;
} & (
  | {
      readonly kind: "relayed";
      readonly errors: PassReadonly<Record<IrWriter.ErrorCode, IrWriter.ErrorDecl>>;
      readonly natures: PassReadonly<Record<IrWriter.NatureId, IrWriter.NatureDecl>>;
    }
  | { readonly kind: "imported"; readonly errors: PassReadonly<ContractIR["errors"]> }
);

// One relay route's copy: where it is reported and what it relays.
interface RelaySite {
  readonly pointer: string;
  readonly relays: string;
}

interface FirstCopy {
  readonly declaration: Declaration;
  readonly site: RelaySite;
}

const isDomainCode = (error: PassReadonly<IrWriter.OperationError>): boolean => {
  const derivation = error.derivedFrom?.derivation;

  return (
    derivation !== undefined &&
    (DOMAIN_DERIVATIONS.includes(derivation) || derivation.startsWith(PACK_DERIVATION_PREFIX))
  );
};

// What two declarations of one name must agree on: everything but the origin, which names each api's file.
function contentOf(declaration: Declaration): string {
  const { origin: _origin, ...content } = declaration;

  return pipelineCanonical(content);
}

function entryOf<Value>(
  catalogue: PassReadonly<Record<string, Value>>,
  id: string,
  what: string,
): PassReadonly<Value> {
  const entry = Object.hasOwn(catalogue, id) ? catalogue[id] : undefined;

  if (entry === undefined)
    throw new Error(`${what} ${id} is not declared in the api that names it`);

  return entry;
}

function publicSide(context: DeriveErrorsContext, relays: IrWriter.OperationRef): PublicSide {
  const { api, id } = relays;
  const relayed = context.relayed(api);
  const isRelayed = (candidate: { readonly kind?: string; readonly id?: string }): boolean =>
    candidate.kind === TREE_NODES_OPERATION_KIND && candidate.id === id;
  const fromDraft = relayed?.operations.find(isRelayed);

  if (relayed !== undefined && fromDraft !== undefined)
    return {
      api,
      operation: fromDraft,
      kind: "relayed",
      errors: relayed.errors,
      natures: relayed.natures,
    };

  const imported = context.imported(api);
  const index =
    imported?.operations.findIndex(
      (candidate) => candidate.kind === TREE_NODES_OPERATION_KIND && candidate.id === id,
    ) ?? -1;
  const found = imported?.operations[index];
  const closed =
    found === undefined
      ? undefined
      : checkIrClosedDeclaration("Operation", pipelineCopy(found), `/operations/${index}`).closed;

  if (imported === undefined || closed === undefined)
    throw new Error(
      `a relay route relays ${api}.${id}, which tree.nodes found but is no closed operation of ${api}`,
    );

  return {
    api,
    operation: closed,
    kind: "imported",
    errors: imported.errors,
  };
}

class RelayCopier {
  readonly copies: DeriveErrorsRelayCopies = {
    errors: new Map(),
    natures: new Map(),
    codes: new Map(),
  };

  private readonly firstErrors = new Map<string, FirstCopy>();
  private readonly firstNatures = new Map<string, FirstCopy>();

  constructor(private readonly sources: DeriveErrorsRelaySources) {}

  copyRoute(route: DeriveErrorsRoute, relays: IrWriter.OperationRef): void {
    const side = publicSide(this.sources.context, relays);
    const site: RelaySite = {
      pointer: pipelinePointerBelow(route.node.pointer, "relays"),
      relays: `${relays.api}.${relays.id}`,
    };
    const publicOrigin = side.operation.origin;

    if (publicOrigin === undefined)
      throw new Error(`the relayed operation ${site.relays} has no origin`);

    const from = [treeNodesRelayOrigin(publicOrigin, side.api)];
    const codes: DeriveErrorsRelayCode[] = [];

    for (const error of side.operation.errors ?? []) {
      if (!isDomainCode(error) || !this.joinDeclaration(side, site, error.code)) continue;

      codes.push({
        code: error.code,
        from,
        ...(error.example === undefined ? {} : { example: pipelineCopy(error.example) }),
        ...(error.roles === undefined ? {} : { roles: pipelineCopy(error.roles) }),
        ...(error.origin === undefined
          ? {}
          : { origin: treeNodesRelayOrigin(error.origin, side.api) }),
      });
    }

    this.copies.codes.set(route.id, codes);
  }

  // Whether the code's declaration is this api's, the same as one already copied, or copied now.
  private joinDeclaration(side: PublicSide, site: RelaySite, code: string): boolean {
    const relayed = entryOf<Declaration>(side.errors, code, `the error of ${site.relays}`);
    const local = this.sources.registry.get(code);

    if (local !== undefined)
      return this.sameAsLocal(
        site,
        `error ${quote(code)}`,
        relayed,
        local.declaration,
        local.pointer,
      );

    const first = this.firstErrors.get(code);

    if (first !== undefined) return this.sameAsFirst(site, `error ${quote(code)}`, relayed, first);

    if (side.kind === "imported") {
      this.sources.reporter.error({
        rule: "relay-declaration",
        pointer: site.pointer,
        message: `error ${quote(code)}, which ${site.relays} answers, is declared in the imported api ${side.api} only, and this compiler does not copy an imported error declaration`,
        fix: `declare ${quote(code)} in this api with the same definition as in ${side.api}`,
      });

      return false;
    }

    const declaration = entryOf(side.errors, code, `the error of ${site.relays}`);

    if (!this.paramsJoin(site, declaration) || !this.natureJoins(side, site, declaration))
      return false;

    this.firstErrors.set(code, { declaration, site });
    this.copies.errors.set(code, {
      declaration: {
        ...pipelineCopy(declaration),
        origin: treeNodesRelayOrigin(declaration.origin, side.api),
      },
    });

    return true;
  }

  private paramsJoin(site: RelaySite, declaration: PassReadonly<IrWriter.ErrorDecl>): boolean {
    const params = declaration.params;

    if (params === undefined || Object.hasOwn(this.sources.schemas, params)) return true;

    this.sources.reporter.error({
      rule: "relay-declaration",
      pointer: site.pointer,
      message: `error ${quote(declaration.code)}, which ${site.relays} answers, has the params schema ${quote(params)}, which this api does not declare`,
      fix: `declare ${quote(params)} in a shared file both apis load`,
    });

    return false;
  }

  private natureJoins(
    side: Extract<PublicSide, { kind: "relayed" }>,
    site: RelaySite,
    declaration: PassReadonly<IrWriter.ErrorDecl>,
  ): boolean {
    const id = declaration.natureName;

    if (id === undefined) return true;

    const nature = entryOf(side.natures, id, `the nature of error ${declaration.code}`);
    const local = this.sources.natures.get(id);
    const what = `nature ${quote(id)}`;

    if (local !== undefined)
      return this.sameAsLocal(site, what, nature, local, local.origin.pointer);

    const first = this.firstNatures.get(id);

    if (first !== undefined) return this.sameAsFirst(site, what, nature, first);

    this.firstNatures.set(id, { declaration: nature, site });
    this.copies.natures.set(id, {
      ...pipelineCopy(nature),
      origin: treeNodesRelayOrigin(nature.origin, side.api),
    });

    return true;
  }

  // A local declaration without a pointer is a core one, located at the relay route alone.
  private sameAsLocal(
    site: RelaySite,
    what: string,
    relayed: Declaration,
    local: Declaration,
    localPointer: string | undefined,
  ): boolean {
    if (contentOf(relayed) === contentOf(local)) return true;

    this.sources.reporter.error({
      rule: "relay-declaration",
      pointer: site.pointer,
      message: `the ${what} that ${site.relays} answers differs from the one this api declares`,
      fix: "declare it once in a shared file both apis load, or rename one of them",
      related:
        localPointer === undefined
          ? []
          : [{ pointer: localPointer, message: `this api's ${what}` }],
    });

    return false;
  }

  private sameAsFirst(
    site: RelaySite,
    what: string,
    relayed: Declaration,
    first: FirstCopy,
  ): boolean {
    if (contentOf(relayed) === contentOf(first.declaration)) return true;

    this.sources.reporter.error({
      rule: "relay-declaration",
      pointer: site.pointer,
      message: `the ${what} that ${site.relays} answers differs from the one ${first.site.relays} answers`,
      fix: "declare it once in a shared file both public apis load, or rename one of them",
      related: [
        { pointer: first.site.pointer, message: `the route relaying ${first.site.relays}` },
      ],
    });

    return false;
  }
}

/** The domain codes every relay route copies, with the declarations and natures this api lacks. */
export function deriveErrorsRelayCopies(
  sources: DeriveErrorsRelaySources,
  routes: readonly DeriveErrorsRoute[],
): DeriveErrorsRelayCopies {
  const copier = new RelayCopier(sources);

  for (const route of routes) {
    const relays = route.operation.relays;

    if (relays !== undefined) copier.copyRoute(route, relays);
  }

  return copier.copies;
}
