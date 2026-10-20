import {
  type ContractIR,
  type CredentialIdentity,
  isKnownVariant,
  type Scheme,
  type SignedIdentity,
} from "@seampact/spec/ir";
import { objectSchemaOf } from "../test-support.js";
import { type RowCase, testRowCases } from "./row-case.test-support.js";

// The declaration rows, each a reference IR pair: a declaration is classified at the operations reaching it, at
// no position when none does. The `user` identity (schemes `bearer` and `sessionCookie`, whose CSRF scheme is
// `csrfToken`) guards the task operations; `stripe` signs `payments`; the `service` identity and the `deadline`
// header are used by no operation.

const ORIGIN = { layer: "api" as const, pointer: "/test" };

function credentialIdentity(ir: ContractIR, id: string): CredentialIdentity {
  const identity = ir.identities[id];

  if (
    identity === undefined ||
    !isKnownVariant("Identity", identity) ||
    identity.kind !== "credential"
  )
    throw new Error(`no credential identity ${id} in the test IR`);

  return identity;
}

function signedIdentity(ir: ContractIR, id: string): SignedIdentity {
  const identity = ir.identities[id];

  if (identity === undefined || !isKnownVariant("Identity", identity) || identity.kind !== "signed")
    throw new Error(`no signed identity ${id} in the test IR`);

  return identity;
}

function schemeOf(ir: ContractIR, id: string): Scheme {
  const scheme = ir.schemes[id];

  if (scheme === undefined) throw new Error(`no scheme ${id} in the test IR`);

  return scheme;
}

function addActorHeader(ir: ContractIR, required: boolean): void {
  credentialIdentity(ir, "user").headers.push({
    header: "actorSurface",
    for: "all",
    required,
    origin: ORIGIN,
  });
}

function entry<Value>(catalogue: Readonly<Record<string, Value>>, id: string): Value {
  const value = catalogue[id];

  if (value === undefined) throw new Error(`no entry ${id} in the test IR`);

  return value;
}

const ROW_CASES: RowCase[] = [
  {
    kind: "declaration",
    case: "added",
    position: "none",
    expected: "info",
    after: (ir) => {
      ir.buckets.read = { id: "read", key: [{ in: "address" }], limit: 600, origin: ORIGIN };
    },
  },
  {
    kind: "declaration",
    case: "removed",
    position: "none",
    expected: "info",
    after: (ir) => {
      delete ir.headers.deadline;
    },
  },
  {
    kind: "scheme",
    case: "name",
    position: "input",
    expected: "C",
    after: (ir) => {
      const scheme = schemeOf(ir, "sessionCookie");

      if (isKnownVariant("Scheme", scheme) && scheme.kind === "cookie") scheme.name = "session";
    },
  },
  {
    kind: "scheme",
    case: "csrf",
    position: "input",
    expected: "C",
    after: (ir) => {
      const scheme = schemeOf(ir, "sessionCookie");

      if (isKnownVariant("Scheme", scheme) && scheme.kind === "cookie") delete scheme.csrf;
    },
  },
  {
    kind: "scheme",
    case: "kind",
    position: "input",
    expected: "C",
    after: (ir) => {
      ir.schemes.csrfToken = {
        id: "csrfToken",
        kind: "query",
        name: "csrf",
        origin: ORIGIN,
      };
    },
  },
  {
    kind: "scheme",
    case: "kind",
    position: "none",
    expected: "info",
    after: (ir) => {
      ir.schemes.internalToken = { id: "internalToken", kind: "basic", origin: ORIGIN };
    },
  },
  {
    kind: "scheme",
    case: "signature",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const scheme = schemeOf(ir, "stripeSignature");

      if (
        isKnownVariant("Scheme", scheme) &&
        scheme.kind === "signature" &&
        isKnownVariant("SignatureVerify", scheme.signature) &&
        scheme.signature.verify === "template"
      )
        scheme.signature.toleranceMs = 60000;
    },
  },
  {
    kind: "identity",
    case: "schemeRemoved",
    position: "input",
    expected: "C",
    after: (ir) => {
      const { schemes } = credentialIdentity(ir, "user");

      schemes.read = ["bearer"];
      schemes.write = ["bearer"];
    },
  },
  {
    kind: "identity",
    case: "schemeAdded",
    position: "input",
    expected: "-",
    after: (ir) => {
      credentialIdentity(ir, "user").schemes.read.push("internalToken");
    },
  },
  {
    kind: "identity",
    case: "schemeRoles",
    position: "input",
    expected: "CS",
    after: (ir) => {
      credentialIdentity(ir, "user").schemes.write = ["bearer"];
    },
  },
  {
    kind: "identity",
    case: "schemeRemoved",
    position: "input",
    expected: "C",
    note: " for a signed identity",
    after: (ir) => {
      signedIdentity(ir, "stripe").signed = "bearer";
    },
  },
  {
    kind: "identity",
    case: "unknownKeys",
    position: "input",
    expected: "CS",
    after: (ir) => {
      signedIdentity(ir, "stripe").unknownKeys = { policy: "keep", reason: "forwarded" };
    },
  },
  {
    kind: "type.changed",
    case: "ref",
    position: "input",
    expected: "CS",
    note: " for an identity principal",
    after: (ir) => {
      credentialIdentity(ir, "user").principal = { kind: "schema", schema: "ServicePrincipal" };
    },
  },
  {
    kind: "identity",
    case: "principal",
    position: "input",
    expected: "CS",
    after: (ir) => {
      credentialIdentity(ir, "user").principal = {
        kind: "variants",
        variants: { user: "UserPrincipal", service: "ServicePrincipal" },
      };
    },
  },
  {
    kind: "identity",
    case: "headerAddedRequired",
    position: "input",
    expected: "C",
    after: (ir) => addActorHeader(ir, true),
  },
  {
    kind: "identity",
    case: "headerAddedOptional",
    position: "input",
    expected: "-",
    after: (ir) => addActorHeader(ir, false),
  },
  {
    kind: "identity",
    case: "headerRemoved",
    position: "input",
    expected: "S",
    base: (ir) => addActorHeader(ir, false),
    after: (ir) => {
      credentialIdentity(ir, "user").headers = [];
    },
  },
  {
    kind: "identity",
    case: "headerChanged",
    position: "input",
    expected: "CS",
    base: (ir) => addActorHeader(ir, false),
    after: (ir) => {
      const [header] = credentialIdentity(ir, "user").headers;

      if (header !== undefined) header.for = "writes";
    },
  },
  {
    kind: "header",
    case: "name",
    position: "input",
    expected: "CS",
    base: (ir) => addActorHeader(ir, false),
    after: (ir) => {
      entry(ir.headers, "actorSurface").name = "X-Surface";
    },
  },
  {
    kind: "header",
    case: "name",
    position: "none",
    expected: "info",
    after: (ir) => {
      entry(ir.headers, "deadline").name = "X-Request-Deadline";
    },
  },
  {
    kind: "right",
    case: "subject",
    position: "input",
    expected: "CS",
    after: (ir) => {
      entry(ir.rights, "roles").subject = { kind: "none" };
    },
  },
  {
    kind: "right",
    case: "guestAdded",
    position: "input",
    expected: "S",
    after: (ir) => {
      entry(ir.rights, "tasks.read").guest = "public channels";
    },
  },
  {
    kind: "right",
    case: "guestRemoved",
    position: "input",
    expected: "C",
    base: (ir) => {
      entry(ir.rights, "tasks.read").guest = "public channels";
    },
    after: (ir) => {
      delete entry(ir.rights, "tasks.read").guest;
    },
  },
  {
    kind: "type.changed",
    case: "ref",
    position: "input",
    expected: "CS",
    note: " for a right's params",
    pointerFragment: "/rights/roles",
    after: (ir) => {
      entry(ir.rights, "roles").params = "RecentAuthParams";
    },
  },
  {
    kind: "property.added",
    case: "required",
    position: "input",
    expected: "C",
    note: " for a right's params schema",
    after: (ir) => {
      const [property] = objectSchemaOf(ir, "RolesParams").properties;

      if (property !== undefined)
        objectSchemaOf(ir, "RolesParams").properties.push({ ...property, name: "level" });
    },
  },
  {
    kind: "property.added",
    case: "required",
    position: "none",
    expected: "info",
    note: " for a schema no operation reaches",
    after: (ir) => {
      const [property] = objectSchemaOf(ir, "ServicePrincipal").properties;

      if (property !== undefined)
        objectSchemaOf(ir, "ServicePrincipal").properties.push({ ...property, name: "region" });
    },
  },
  {
    kind: "rule",
    case: "takesBucket",
    position: "input",
    expected: "CS",
    after: (ir) => {
      entry(ir.rules, "recentAuth").takesBucket = true;
    },
  },
  {
    kind: "rule",
    case: "proof",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const { proof } = entry(ir.rules, "recentAuth");

      if (proof !== undefined) proof.in = "header";
    },
  },
  {
    kind: "scope",
    case: "within",
    position: "input",
    expected: "CS",
    after: (ir) => {
      entry(ir.scopes, "channel").within = "channel";
    },
  },
  {
    kind: "type.changed",
    case: "format",
    position: "input",
    expected: "CS",
    note: " for a scope id",
    after: (ir) => {
      const { idSchema } = entry(ir.scopes, "channel");

      if (isKnownVariant("TypeUse", idSchema) && idSchema.kind === "scalar") delete idSchema.format;
    },
  },
  {
    kind: "bucket",
    case: "key",
    position: "input",
    expected: "CS",
    after: (ir) => {
      entry(ir.buckets, "write").key = [{ in: "address" }];
    },
  },
  {
    kind: "refinement",
    case: "tightened",
    position: "input",
    expected: "C",
    note: " for a lower bucket limit",
    after: (ir) => {
      entry(ir.buckets, "write").limit = 30;
    },
  },
  {
    kind: "refinement",
    case: "loosened",
    position: "input",
    expected: "S",
    note: " for a shorter bucket window",
    after: (ir) => {
      entry(ir.buckets, "write").windowMs = 1000;
    },
  },
  {
    kind: "error",
    case: "status",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.errors, "api.not_found").http.status = 410;
    },
  },
  {
    kind: "error",
    case: "nature",
    position: "output",
    expected: "C",
    after: (ir) => {
      entry(ir.errors, "api.not_found").nature = "unavailable";
    },
  },
  {
    kind: "error",
    case: "family",
    position: "output",
    expected: "C",
    after: (ir) => {
      entry(ir.errors, "api.not_found").family = "lookup";
    },
  },
  {
    kind: "format",
    case: "media",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.formats, "bare").media = "application/vnd.tasks+json";
    },
  },
  {
    kind: "format",
    case: "absent",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.formats, "bare").absent = "null";
    },
  },
  {
    kind: "pagingStyle",
    case: "request",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const [cursor] = entry(ir.pagings, "cursor").request;

      if (cursor !== undefined) cursor.name = "after";
    },
  },
  {
    kind: "pagingStyle",
    case: "handlerResult",
    position: "output",
    expected: "S",
    after: (ir) => {
      entry(ir.pagings, "cursor").handlerResult.push("total");
    },
  },
  {
    kind: "pagingStyle",
    case: "position",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.pagings, "cursor").position = "offset";
    },
  },
  {
    kind: "pagingStyle",
    case: "absent",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.pagings, "cursor").absent = "null";
    },
  },
  {
    kind: "scope",
    case: "within",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.scopes, "channel").within = "channel";
    },
  },
  {
    kind: "right",
    case: "subject",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.rights, "tasks.read").subject = { kind: "none" };
    },
  },
  {
    kind: "right",
    case: "guestAdded",
    position: "output",
    expected: "S",
    after: (ir) => {
      entry(ir.rights, "tasks.read").guest = "public channels";
    },
  },
  {
    kind: "right",
    case: "guestRemoved",
    position: "output",
    expected: "C",
    base: (ir) => {
      entry(ir.rights, "tasks.read").guest = "public channels";
    },
    after: (ir) => {
      delete entry(ir.rights, "tasks.read").guest;
    },
  },
  {
    kind: "identity",
    case: "kind",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const { schemes: _schemes, ...user } = credentialIdentity(ir, "user");

      ir.identities.user = { ...user, kind: "signed", signed: "stripeSignature" };
    },
  },
  {
    kind: "identity",
    case: "schemeAdded",
    position: "none",
    expected: "info",
    after: (ir) => {
      credentialIdentity(ir, "service").schemes.read.push("bearer");
    },
  },
  {
    kind: "header",
    case: "semantic",
    position: "input",
    expected: "CS",
    base: (ir) => addActorHeader(ir, false),
    after: (ir) => {
      entry(ir.headers, "actorSurface").semantic = "deadline";
    },
  },
  {
    kind: "error",
    case: "status",
    position: "none",
    expected: "info",
    base: (ir) => {
      ir.errors["api.gone"] = {
        ...structuredClone(entry(ir.errors, "api.not_found")),
        code: "api.gone",
      };
    },
    after: (ir) => {
      entry(ir.errors, "api.gone").http.status = 410;
    },
  },
  {
    kind: "format",
    case: "success",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.formats, "bare").success.item.headers.push({
        name: "X-Kind",
        value: { kind: "literal", value: "item" },
      });
    },
  },
  {
    kind: "format",
    case: "meta",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.formats, "bare").meta.servedAt = {
        type: { kind: "scalar", type: "string", refinements: {} },
        fill: "now",
      };
    },
  },
  {
    kind: "format",
    case: "error",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.formats, "bare").error.media = "application/json";
    },
  },
  {
    kind: "pagingStyle",
    case: "position",
    position: "input",
    expected: "CS",
    after: (ir) => {
      entry(ir.pagings, "cursor").position = "offset";
    },
  },
  {
    kind: "pagingStyle",
    case: "response",
    position: "output",
    expected: "CS",
    after: (ir) => {
      entry(ir.pagings, "cursor").response.links.push({ rel: "first", role: "first" });
    },
  },
  {
    kind: "property.removed",
    case: "required",
    position: "none",
    expected: "info",
    note: " for a schema no operation reaches",
    after: (ir) => {
      objectSchemaOf(ir, "ServicePrincipal").properties.pop();
    },
  },
  {
    kind: "nullable",
    case: "added",
    position: "none",
    expected: "info",
    note: " for a schema no operation reaches",
    after: (ir) => {
      const [property] = objectSchemaOf(ir, "ServicePrincipal").properties;

      if (property !== undefined) property.nullable = true;
    },
  },
  {
    kind: "type.changed",
    case: "kind",
    position: "none",
    expected: "info",
    note: " for a schema no operation reaches",
    after: (ir) => {
      const [property] = objectSchemaOf(ir, "ServicePrincipal").properties;

      if (property !== undefined)
        property.type = { kind: "scalar", type: "string", refinements: {} };
    },
  },
  {
    kind: "refinement",
    case: "tightened",
    position: "none",
    expected: "info",
    note: " for a schema no operation reaches",
    after: (ir) => {
      const userId = objectSchemaOf(ir, "ServicePrincipal").properties[1];

      if (userId?.type.kind === "scalar" && "refinements" in userId.type)
        userId.type.refinements.maxLength = 36;
    },
  },
];

testRowCases("the declaration rows", ROW_CASES);
