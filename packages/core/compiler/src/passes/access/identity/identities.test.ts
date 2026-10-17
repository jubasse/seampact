import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import type { TreeSchemaService } from "../../../pipeline/seam.js";
import { treeNodesUnansweredAt } from "../../tree/nodes/test-support.js";
import {
  type AccessIdentitySchemaUseRow,
  accessIdentityCataloguesExpected,
  accessIdentityCataloguesRun,
  accessIdentityDraft,
  accessIdentityInline,
  accessIdentityObjectSchema,
  accessIdentityRun,
  accessIdentityTableService,
} from "./test-support.js";

const STRING: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };

const CATALOGUES = `api: { name: a, version: 1 }
schemes:
  session: { kind: cookie, name: s }
  bearer: { kind: bearer }
  hook: { kind: signature, verify: application, name: X-Sig }
headers:
  deadline: { name: X-Deadline, in: request, semantic: deadline }
  surface: { name: X-Surface, in: request, semantic: actorSurface }
  typedSurface: { name: X-Typed-Surface, in: request, semantic: actorSurface, schema: { enum: Surface } }
  rights: { semantic: versionToken, response: X-Rights, request: If-Rights }
enums:
  Surface: { values: [app, studio], reason: "The product's entry points." }
`;

const PROFILE = accessIdentityObjectSchema("Profile", { rightsVersion: STRING });
const USER = accessIdentityObjectSchema("UserPrincipal", {
  userId: STRING,
  profile: { kind: "ref", schema: "Profile" },
});
const DEVICE = accessIdentityObjectSchema("DevicePrincipal", { deviceId: STRING });
const SETTINGS: IrWriter.KnownSchema = {
  kind: "map",
  values: STRING,
  id: "Settings",
  name: { segments: ["settings"], role: "schema" },
  directions: ["output"],
  examples: [],
  docs: {},
  extensions: {},
  origin: { layer: "api", pointer: "/schemas/Settings" },
};

const ref = (schema: string): IrWriter.TypeUse => ({ kind: "ref", schema });

const principalOf = (id: string, use: IrWriter.TypeUse = ref("UserPrincipal")) => ({
  pointer: `/identities/${id}/principal`,
  direction: "output" as const,
  use,
});

const SURFACE_USE: IrWriter.TypeUse = { kind: "enum", enum: "Surface" };

const HEADER_SCHEMAS: AccessIdentitySchemaUseRow[] = [
  { pointer: "/headers/typedSurface/schema", direction: "input", use: SURFACE_USE },
];

// Runs the half on the shared catalogues and these identities; every identity's principal is UserPrincipal
// unless `rows` answers otherwise.
function compileIdentities(identities: string, rows: AccessIdentitySchemaUseRow[] = []) {
  const contract = accessIdentityInline(`${CATALOGUES}identities:\n${identities}`);
  const written = Object.keys(contract.raw.merged.identities ?? {});
  const principals = written.map((id) => principalOf(id));

  return {
    contract,
    ...accessIdentityRun(
      contract,
      accessIdentityDraft([PROFILE, USER, DEVICE, SETTINGS]),
      accessIdentityTableService([...rows, ...principals, ...HEADER_SCHEMAS]),
    ),
  };
}

function refusals(identities: string, rows: AccessIdentitySchemaUseRow[] = []) {
  const { draft, diagnostics } = compileIdentities(identities, rows);

  return {
    written: Object.keys(draft.identities),
    diagnostics: diagnostics.map(({ rule, message, origin, related }) => ({
      rule,
      message,
      pointer: origin.pointer,
      ...(related.length === 0 ? {} : { related: related.map((item) => item.origin.pointer) }),
    })),
  };
}

describe("identities and principal variants", () => {
  test("credential and signed identities, with one principal or variants", () => {
    const { draft, diagnostics } = accessIdentityCataloguesRun();

    expect(diagnostics).toEqual([]);
    expect({ ...draft.identities }).toEqual(accessIdentityCataloguesExpected("identities"));
  });

  test("an identity needs a principal, and a credential one its schemes", () => {
    expect(
      refusals(`
  nothing: { principal: UserPrincipal }
  anonymous: { schemes: { read: [bearer], write: [bearer] } }
  signedBare: { kind: signed, principal: UserPrincipal }`),
    ).toEqual({
      written: [],
      diagnostics: [
        {
          rule: "seampact/access/identity-member",
          message: "credential identity 'nothing' has no 'schemes'",
          pointer: "/identities/nothing",
        },
        {
          rule: "seampact/access/identity-member",
          message: "identity 'anonymous' has no 'principal'",
          pointer: "/identities/anonymous",
        },
        {
          rule: "seampact/access/identity-member",
          message: "signed identity 'signedBare' has no 'scheme'",
          pointer: "/identities/signedBare",
        },
      ],
    });
  });

  test("scheme references: declared, a signature only on a signed identity", () => {
    expect(
      refusals(`
  user:
    schemes: { read: [bearer, missing], write: [hook], optionalRead: [] }
    principal: UserPrincipal
  webhook: { kind: signed, scheme: bearer, principal: UserPrincipal }
  ghost: { kind: signed, scheme: missing, principal: UserPrincipal }
  partner: { schemes: { read: [session], write: [] }, principal: UserPrincipal }`),
    ).toEqual({
      written: ["partner"],
      diagnostics: [
        {
          rule: "seampact/access/scheme-reference",
          message: "identity 'user' names scheme 'missing', which is not declared",
          pointer: "/identities/user/schemes/read/1",
        },
        {
          rule: "seampact/access/scheme-kind",
          message: "credential identity 'user' names signature scheme 'hook'",
          pointer: "/identities/user/schemes/write/0",
        },
        {
          rule: "seampact/access/scheme-kind",
          message:
            "signed identity 'webhook' names bearer scheme 'bearer'; a signed identity takes a signature scheme",
          pointer: "/identities/webhook/scheme",
        },
        {
          rule: "seampact/access/scheme-reference",
          message: "signed identity 'ghost' names scheme 'missing', which is not declared",
          pointer: "/identities/ghost/scheme",
        },
      ],
    });
  });

  test("a scheme is listed once in each list", () => {
    expect(
      refusals(`
  dup: { schemes: { read: [bearer, session, bearer], write: [bearer] }, principal: UserPrincipal }`),
    ).toEqual({
      written: [],
      diagnostics: [
        {
          rule: "seampact/access/scheme-reference",
          message: "identity 'dup' lists scheme 'bearer' twice in 'read'",
          pointer: "/identities/dup/schemes/read/2",
        },
      ],
    });
  });

  test("a principal is a named schema in every variant; a map is refused only where a field is read", () => {
    const variant = (id: string, name: string, use: IrWriter.TypeUse) => ({
      pointer: `/identities/${id}/principal/variants/${name}`,
      direction: "output" as const,
      use,
    });

    expect(
      refusals(
        `
  scalar: { schemes: { read: [bearer], write: [bearer] }, principal: { type: string } }
  inlineVariant:
    schemes: { read: [bearer], write: [bearer] }
    principal: { variants: { viewer: UserPrincipal, tags: { type: array, items: { type: string } } } }
  none:
    schemes: { read: [bearer], write: [bearer] }
    principal: { variants: {} }
  map: { schemes: { read: [bearer], write: [bearer] }, principal: Settings }
  mixed:
    schemes: { read: [bearer], write: [bearer] }
    principal: { variants: { viewer: UserPrincipal, device: Settings } }
  mapField:
    schemes: { read: [session], write: [session] }
    principal: Settings
    headers:
      rights: { from: principal.version, for: writes, stale: api.stale }`,
        [
          principalOf("scalar", STRING),
          variant("inlineVariant", "viewer", ref("UserPrincipal")),
          variant("inlineVariant", "tags", { kind: "array", items: STRING }),
          principalOf("map", ref("Settings")),
          variant("mixed", "viewer", ref("UserPrincipal")),
          variant("mixed", "device", ref("Settings")),
          principalOf("mapField", ref("Settings")),
        ],
      ),
    ).toEqual({
      written: ["map", "mixed"],
      diagnostics: [
        {
          rule: "seampact/access/principal",
          message:
            "the principal of identity 'scalar' is an inline schema of kind scalar, not a named schema",
          pointer: "/identities/scalar/principal",
        },
        {
          rule: "seampact/access/principal",
          message:
            "the principal of identity 'inlineVariant' is an inline schema of kind array, not a named schema",
          pointer: "/identities/inlineVariant/principal/variants/tags",
        },
        {
          rule: "seampact/access/principal",
          message: "the principal of identity 'none' lists no variant",
          pointer: "/identities/none/principal/variants",
        },
        {
          rule: "seampact/access/principal-field",
          message:
            "identity 'mapField' reads header 'rights' from principal field 'version', but the principal schema 'Settings' is a map, not an object schema",
          pointer: "/identities/mapField/headers/rights/from",
        },
      ],
    });
  });

  test("a written schema the schema service does not answer is an internal error naming the pointer", () => {
    const principal = accessIdentityInline(
      `api: { name: a, version: 1 }
schemes:
  bearer: { kind: bearer }
identities:
  user: { schemes: { read: [bearer], write: [bearer] }, principal: UserPrincipal }
`,
    );

    expect(() =>
      accessIdentityRun(
        principal,
        accessIdentityDraft(),
        treeNodesUnansweredAt(accessIdentityTableService([]), "/identities/user/principal"),
      ),
    ).toThrow(
      "the schema service answers no output type use for the schema written at /identities/user/principal",
    );

    const header = accessIdentityInline(CATALOGUES);

    expect(() =>
      accessIdentityRun(
        header,
        accessIdentityDraft(),
        treeNodesUnansweredAt(accessIdentityTableService([]), "/headers/typedSurface/schema"),
      ),
    ).toThrow(
      "the schema service answers no input type use for the schema written at /headers/typedSurface/schema",
    );
  });
});

describe("identity headers", () => {
  test("declarations by semantic, and uses with their facts", () => {
    const { draft } = accessIdentityCataloguesRun();

    expect({ ...draft.headers }).toEqual(accessIdentityCataloguesExpected("headers"));
  });

  test("a declaration names its header and side, or a versionToken its two headers", () => {
    const contract = accessIdentityInline(`api: { name: a, version: 1 }
headers:
  deadline: { semantic: deadline, in: request }
  trace: { semantic: traceContext, name: traceparent }
  rights: { semantic: versionToken, response: X-Rights }
`);
    const { draft, diagnostics } = accessIdentityRun(
      contract,
      accessIdentityDraft(),
      accessIdentityTableService([]),
    );

    expect(Object.keys(draft.headers)).toEqual([]);
    expect(diagnostics.map(({ rule, message }) => [rule, message])).toEqual([
      ["seampact/access/header-declaration", "deadline header 'deadline' has no 'name'"],
      ["seampact/access/header-declaration", "traceContext header 'trace' has no 'in'"],
      ["seampact/access/header-declaration", "versionToken header 'rights' has no 'request'"],
    ]);
  });

  test("a use names a declared header, and sets a schema only where the declaration has none", () => {
    expect(
      refusals(
        `
  user:
    schemes: { read: [bearer], write: [bearer] }
    principal: UserPrincipal
    headers:
      missing: { for: all }
      typedSurface: { for: writes, schema: { enum: Surface } }
      surface: { for: writes }`,
        [
          {
            pointer: "/identities/user/headers/typedSurface/schema",
            direction: "input",
            use: SURFACE_USE,
          },
        ],
      ),
    ).toEqual({
      written: [],
      diagnostics: [
        {
          rule: "seampact/access/header-use",
          message: "identity 'user' uses header 'missing', which is not declared",
          pointer: "/identities/user/headers/missing",
        },
        {
          rule: "seampact/access/header-use",
          message:
            "identity 'user' sets a schema on header 'typedSurface', whose declaration already has one",
          pointer: "/identities/user/headers/typedSurface/schema",
          related: ["/headers/typedSurface/schema"],
        },
        {
          rule: "seampact/access/header-use",
          message:
            "actorSurface header 'surface' has no schema in its declaration or in identity 'user'",
          pointer: "/identities/user/headers/surface",
        },
      ],
    });
  });

  test("a stored schema use is a copy, even when the service answers one shared object", () => {
    const shared: IrWriter.TypeUse = { kind: "enum", enum: "Surface" };
    const contract = accessIdentityInline(`api: { name: a, version: 1 }
headers:
  first: { name: X-First, in: request, semantic: actorSurface, schema: { enum: Surface } }
  second: { name: X-Second, in: request, semantic: actorSurface, schema: { enum: Surface } }
enums:
  Surface: { values: [app, studio], reason: "The product's entry points." }
`);
    const sharedService: TreeSchemaService = {
      typeUse: () => shared,
      queryWire: () => undefined,
      checkExample: () => [],
      checkTextExample: () => [],
    };
    const { draft } = accessIdentityRun(contract, accessIdentityDraft(), sharedService);

    Object.assign(shared, { enum: "Changed" });
    expect([draft.headers.first?.schema, draft.headers.second?.schema]).toEqual([
      SURFACE_USE,
      SURFACE_USE,
    ]);
  });

  test("an actorSurface schema is an enum", () => {
    expect(
      refusals(
        `
  user:
    schemes: { read: [bearer], write: [bearer] }
    principal: UserPrincipal
    headers:
      surface: { for: writes, schema: { type: string } }`,
        [{ pointer: "/identities/user/headers/surface/schema", direction: "input", use: STRING }],
      ).diagnostics,
    ).toEqual([
      {
        rule: "seampact/access/header-use",
        message:
          "actorSurface header 'surface' has a schema of kind scalar; an actor surface is a strict enum",
        pointer: "/identities/user/headers/surface/schema",
      },
    ]);
  });

  test("an actorSurface declaration's schema is an enum", () => {
    const contract = accessIdentityInline(`api: { name: a, version: 1 }
headers:
  surface: { name: X-Surface, in: request, semantic: actorSurface, schema: { type: string } }
`);
    const { draft, diagnostics } = accessIdentityRun(
      contract,
      accessIdentityDraft(),
      accessIdentityTableService([
        { pointer: "/headers/surface/schema", direction: "input", use: STRING },
      ]),
    );

    expect(Object.keys(draft.headers)).toEqual([]);
    expect(diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
      ["seampact/access/header-declaration", "/headers/surface/schema"],
    ]);
  });

  test("from and stale belong to a versionToken use, which needs both and a principal field", () => {
    expect(
      refusals(`
  user:
    schemes: { read: [session], write: [session] }
    principal: UserPrincipal
    headers:
      deadline: { from: principal.userId, stale: api.stale }
      rights: { from: principal.profile.rightsVersion }
  noFrom:
    schemes: { read: [session], write: [session] }
    principal: UserPrincipal
    headers:
      rights: { for: writes, stale: api.stale }
  operator:
    schemes: { read: [session], write: [session] }
    principal: UserPrincipal
    headers:
      rights: { from: principal.profile.missing, for: writes, stale: api.stale }
  nested:
    schemes: { read: [session], write: [session] }
    principal: UserPrincipal
    headers:
      rights: { from: principal.profile.rightsVersion, for: writes, stale: api.stale }`),
    ).toEqual({
      written: ["nested"],
      diagnostics: [
        {
          rule: "seampact/access/header-use",
          message: "identity 'user' sets 'from' and 'stale' on deadline header 'deadline'",
          pointer: "/identities/user/headers/deadline",
        },
        {
          rule: "seampact/access/header-use",
          message: "identity 'user' uses versionToken header 'rights' without 'stale'",
          pointer: "/identities/user/headers/rights",
        },
        {
          rule: "seampact/access/header-use",
          message: "identity 'noFrom' uses versionToken header 'rights' without 'from'",
          pointer: "/identities/noFrom/headers/rights",
        },
        {
          rule: "seampact/access/principal-field",
          message:
            "identity 'operator' reads header 'rights' from principal field 'profile.missing', which its principal does not hold",
          pointer: "/identities/operator/headers/rights/from",
        },
      ],
    });
  });

  test("a versionToken field is held by every variant", () => {
    const variant = (name: string, schema: string) => ({
      pointer: `/identities/either/principal/variants/${name}`,
      direction: "output" as const,
      use: ref(schema),
    });
    const { diagnostics } = compileIdentities(
      `
  either:
    schemes: { read: [session], write: [session] }
    principal: { variants: { user: UserPrincipal, device: DevicePrincipal } }
    headers:
      rights: { from: principal.userId, for: writes, stale: api.stale }`,
      [variant("user", "UserPrincipal"), variant("device", "DevicePrincipal")],
    );

    expect(diagnostics.map(({ message }) => message)).toEqual([
      "identity 'either' reads header 'rights' from principal field 'userId', which its principal does not hold in every variant",
    ]);
  });
});

describe("access.identity diagnostics are located", () => {
  test("every diagnostic names its rule, message and fix, and resolves through the side table", () => {
    const { contract, diagnostics } = compileIdentities(`
  user:
    schemes: { read: [missing], write: [hook] }
    principal: UserPrincipal
    headers:
      typedSurface: { schema: { enum: Surface } }
      surface: {}
      deadline: { stale: api.stale }
  signedBare: { kind: signed, principal: UserPrincipal }`);

    expect(diagnostics.map(({ rule }) => rule.replace("seampact/access/", ""))).toEqual([
      "scheme-reference",
      "scheme-kind",
      "header-use",
      "header-use",
      "header-use",
      "identity-member",
    ]);
    const locations = contract.raw.locations;

    for (const diagnostic of diagnostics) {
      expect(diagnostic.severity).toBe("error");
      expect(diagnostic.rule).toMatch(/^seampact\/access\/[a-z]+(-[a-z]+)*$/);
      expect(diagnostic.message).not.toBe("");
      expect(diagnostic.fix).toMatch(/\.$/);

      for (const origin of [diagnostic.origin, ...diagnostic.related.map((item) => item.origin)])
        expect(Object.hasOwn(locations, diagnosticLocationKey(origin))).toBe(true);
    }
  });
});
