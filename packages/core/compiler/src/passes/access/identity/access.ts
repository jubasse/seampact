import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftOperation,
  type InheritedEntry,
  type PassContextOf,
  type PassReadonly,
  pipelineCopy,
  type TreeNode,
} from "../../../pipeline/seam.js";
import {
  accessIdentityIsObject,
  accessIdentityObject,
  accessIdentityPointer,
  accessIdentityString,
} from "./read.js";
import type { AccessIdentityReporter } from "./report.js";

// Who may call each operation (ADR 0002 sections 5 and 9, ADR 0004 section 7): `identity` and `access` are
// inherited separately, the nearest winning for each, and a node setting `identity` below the nearest `access`
// makes the identity required again. Deny by default: a route that resolves to neither an identity nor a public
// access is refused, naming both fixes (FR-4). A service api runs every route under its caller identity (FR-8).

type Context = PassContextOf<"access.identity">;

// ADR 0002 section 5: a service api states its caller identity at `api.caller.identity`.
const SERVICE_CALLER_POINTER = "/api/caller/identity";

/** The catalogues this half built, for the per-operation members. */
export interface AccessIdentityBuilt {
  schemes: ReadonlyMap<string, IrWriter.KnownScheme>;
  identities: ReadonlyMap<string, IrWriter.KnownIdentity>;
}

/** What the per-operation members read besides the operation. */
export interface AccessIdentityScope {
  context: Context;
  built: AccessIdentityBuilt;
  schemas: PassReadonly<Record<string, IrWriter.Schema>>;
  /** The caller identity of a service api, which every route of it runs under. */
  caller?: string;
  reporter: AccessIdentityReporter;
}

/** An operation with the tree node it was written from. */
export interface AccessIdentityRoute {
  id: string;
  node: TreeNode;
  safe: boolean;
  operation: DraftOperation;
}

/** An operation's access, with the identity it runs under (none on a public route). */
export interface AccessIdentityResolved {
  access: IrWriter.KnownAccess;
  identity?: IrWriter.KnownIdentity;
}

interface IdentitySource {
  name: string;
  /** The raw pointer the identity is named at. */
  pointer: string;
  origin: IrWriter.Origin;
}

/** The access of a route; undefined when refused, with the error reported. */
export function accessIdentityAccess(
  route: AccessIdentityRoute,
  scope: AccessIdentityScope,
): AccessIdentityResolved | undefined {
  const identityEntry = scope.context.inherited(route.node, "identity")?.entry;
  const accessEntry = scope.context.inherited(route.node, "access")?.entry;
  const source = identitySource(identityEntry, scope);

  if (accessEntry !== undefined && !isBelow(identityEntry?.node, accessEntry.node))
    return writtenAccess(route, accessEntry, source, scope);

  if (source === undefined) {
    scope.reporter.error({
      rule: "deny-by-default",
      message: `route '${route.id}' has no identity and no public access`,
      fix: "Set 'identity: <name>' on it or an ancestor, or 'access: { public: \"<reason>\" }'.",
      pointer: route.node.pointer,
    });
    return undefined;
  }

  return requiredAccess(route, source, scope);
}

/** The caller kinds an access admits (ADR 0004 section 7), sorted. */
export function accessIdentityCallerKinds(access: IrWriter.KnownAccess): IrWriter.CallerKind[] {
  switch (access.kind) {
    case "identity":
      return ["identified"];
    case "optional":
      return ["anonymous", "identified"];
    case "public":
      return ["anonymous"];
  }
}

/** Reports every node of a service api that sets an identity other than the caller's. */
export function accessIdentityServiceNodes(
  nodes: readonly TreeNode[],
  caller: string,
  reporter: AccessIdentityReporter,
): void {
  for (const node of nodes) {
    const written = Object.hasOwn(node.settings, "identity") ? node.settings.identity : undefined;
    if (written === undefined || written === caller) continue;

    reporter.error({
      rule: "service-identity",
      message: `${node.kind} '${node.name}' of a service api sets identity ${JSON.stringify(written)}, while every route of the api runs under its caller identity '${caller}'`,
      fix: "Remove the identity: the routes of a service api run under 'api.caller.identity', which surfaces need not repeat.",
      pointer: accessIdentityPointer(node.pointer, "identity"),
    });
  }
}

// Whether `node` sits strictly below `ancestor`: the identity set there makes the identity required again.
function isBelow(node: TreeNode | undefined, ancestor: TreeNode): boolean {
  if (node === undefined || node === ancestor) return false;
  for (let at = node.parent; at !== undefined; at = at.parent) if (at === ancestor) return true;
  return false;
}

function identitySource(
  entry: InheritedEntry | undefined,
  scope: AccessIdentityScope,
): IdentitySource | undefined {
  if (entry !== undefined) {
    // The authoring schema writes an identity as its name.
    if (typeof entry.value !== "string")
      throw new Error(`the identity set at ${entry.node.pointer} is not a name`);
    return {
      name: entry.value,
      pointer: accessIdentityPointer(entry.node.pointer, "identity"),
      origin: pipelineCopy(entry.origin),
    };
  }

  if (scope.caller === undefined) return undefined;
  const origin = scope.context.origin(SERVICE_CALLER_POINTER);
  if (origin === undefined)
    throw new Error(`the service api has a caller identity, yet nothing at ${SERVICE_CALLER_POINTER}`);
  return { name: scope.caller, pointer: SERVICE_CALLER_POINTER, origin };
}

// The identity a source names; undefined when it is refused (reported here, or with the identity itself).
function identityOf(
  source: IdentitySource,
  scope: AccessIdentityScope,
): IrWriter.KnownIdentity | undefined {
  // A service api's node naming another identity is reported once, by `accessIdentityServiceNodes`.
  if (scope.caller !== undefined && source.name !== scope.caller) return undefined;

  const identity = scope.built.identities.get(source.name);
  if (identity !== undefined) return identity;

  // An identity left out of the catalogue for an error of its own is already reported.
  const written = accessIdentityObject(scope.context.raw.merged, "identities");
  if (written !== undefined && Object.hasOwn(written, source.name)) return undefined;

  scope.reporter.error({
    rule: "identity-reference",
    message: `identity '${source.name}' is not declared`,
    fix: "Declare the identity under 'identities', or name a declared one.",
    pointer: source.pointer,
  });
  return undefined;
}

function writtenAccess(
  route: AccessIdentityRoute,
  entry: InheritedEntry,
  source: IdentitySource | undefined,
  scope: AccessIdentityScope,
): AccessIdentityResolved | undefined {
  const pointer = accessIdentityPointer(entry.node.pointer, "access");
  // The authoring schema writes `access` as `{ public }` or `{ optionalAuth, onRefused? }`.
  const written = accessIdentityIsObject(entry.value) ? entry.value : undefined;
  const reason = written === undefined ? undefined : accessIdentityString(written, "public");
  const optionalReason =
    written === undefined ? undefined : accessIdentityString(written, "optionalAuth");
  if (written === undefined || (reason === undefined && optionalReason === undefined))
    throw new Error(`the access at ${pointer} is neither public nor optionalAuth`);

  if (scope.caller !== undefined) {
    scope.reporter.error({
      rule: "service-access",
      message: `a service api runs every route under its caller identity '${scope.caller}', so ${reason === undefined ? "optional-auth" : "public"} access is refused`,
      fix: "Remove 'access': the routes of a service api are identified by 'api.caller.identity'.",
      pointer,
    });
    return undefined;
  }

  const origin = pipelineCopy(entry.origin);
  if (reason !== undefined) return { access: { kind: "public", reason, origin } };

  const onRefused: IrWriter.RefusedCredential =
    accessIdentityString(written, "onRefused") === "reject" ? "reject" : "anonymous";
  return optionalAccess(route, { reason: optionalReason ?? "", onRefused, origin, pointer }, source, scope);
}

interface OptionalWritten {
  reason: string;
  onRefused: IrWriter.RefusedCredential;
  origin: IrWriter.Origin;
  pointer: string;
}

function optionalAccess(
  route: AccessIdentityRoute,
  written: OptionalWritten,
  source: IdentitySource | undefined,
  scope: AccessIdentityScope,
): AccessIdentityResolved | undefined {
  if (source === undefined) {
    scope.reporter.error({
      rule: "optional-identity",
      message: `route '${route.id}' has optional access and no identity to make optional`,
      fix: "Set 'identity: <name>' on it or an ancestor, or make the access 'public' with its reason.",
      pointer: route.node.pointer,
      related: [{ pointer: written.pointer, message: "the optional access" }],
    });
    return undefined;
  }

  const identity = identityOf(source, scope);
  if (identity === undefined) return undefined;

  // ADR 0013: a signed route always carries the signature, so an anonymous caller never reaches it.
  if (identity.kind === "signed") {
    scope.reporter.error({
      rule: "signed-access",
      message: `optional access is written under signed identity '${identity.id}', whose routes always verify a signature`,
      fix: "Remove 'optionalAuth' under the signed identity, or make the route public with its reason.",
      pointer: written.pointer,
      related: [{ pointer: source.pointer, message: "the signed identity" }],
    });
    return undefined;
  }

  const schemes = credentialSchemes(route, identity, "optional", scope);
  if (schemes === undefined) return undefined;
  return {
    access: {
      kind: "optional",
      identity: identity.id,
      schemes,
      reason: written.reason,
      onRefused: written.onRefused,
      origin: written.origin,
    },
    identity,
  };
}

function requiredAccess(
  route: AccessIdentityRoute,
  source: IdentitySource,
  scope: AccessIdentityScope,
): AccessIdentityResolved | undefined {
  const identity = identityOf(source, scope);
  if (identity === undefined) return undefined;

  if (identity.kind === "signed")
    return {
      access: {
        kind: "identity",
        identity: identity.id,
        schemes: [identity.signed],
        origin: source.origin,
      },
      identity,
    };

  const schemes = credentialSchemes(route, identity, "required", scope);
  if (schemes === undefined) return undefined;
  return {
    access: { kind: "identity", identity: identity.id, schemes, origin: source.origin },
    identity,
  };
}

// ADR 0002 section 9: the schemes of the route's direction, and `optionalRead` on an optional read only, so adding
// a read scheme never widens writes. An access's scheme list is never empty.
function credentialSchemes(
  route: AccessIdentityRoute,
  identity: IrWriter.CredentialIdentity,
  access: "required" | "optional",
  scope: AccessIdentityScope,
): string[] | undefined {
  const list = route.safe ? "read" : "write";
  const extra = access === "optional" && route.safe ? identity.schemes.optionalRead : [];
  const schemes = [...new Set([...identity.schemes[list], ...extra])].sort();
  if (schemes.length > 0) return schemes;

  const direction = route.safe ? "reads" : "writes";
  scope.reporter.error({
    rule: "access-schemes",
    message: `route '${route.id}' is a ${route.safe ? "read" : "write"} under identity '${identity.id}', which accepts no scheme on ${direction}`,
    fix: `List a scheme in the identity's 'schemes.${list}', or put the route under an identity that accepts ${direction}.`,
    pointer: route.node.pointer,
    related: [
      {
        pointer: accessIdentityPointer("", "identities", identity.id, "schemes", list),
        message: `the identity's ${list} schemes`,
      },
    ],
  });
  return undefined;
}
