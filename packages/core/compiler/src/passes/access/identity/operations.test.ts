import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { createDraftValidator } from "../../../pipeline/draft-schema.js";
import type { DraftIR, DraftOperation } from "../../../pipeline/seam.js";
import {
  type AccessIdentitySchemaUseRow,
  accessIdentityDraft,
  accessIdentityFixtureJson,
  accessIdentityInline,
  accessIdentityObjectSchema,
  accessIdentityRoutesFixtureRun,
  accessIdentityRoutesRun,
  accessIdentityTableService,
} from "./test-support.js";

const STRING: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };
const TEXT_WIRE: IrWriter.QueryWire = {
  kind: "text",
  style: "form",
  explode: true,
  brackets: false,
};

const API = "api: { name: a, version: 1 }";
const SERVICE_API =
  "api: { name: a, version: 1, kind: service, caller: { identity: viewer, right: callerService } }";

const BASE = `schemes:
  session: { kind: cookie, name: s, csrf: csrfHeader }
  plainSession: { kind: cookie, name: p }
  csrfHeader: { kind: header, name: X-Csrf }
  otherSession: { kind: cookie, name: o, csrf: otherCsrf }
  otherCsrf: { kind: header, name: X-Other-Csrf }
  bearer: { kind: bearer }
  device: { kind: header, name: X-Device }
  mapsKey: { kind: query, name: key }
  stripeSig:
    kind: signature
    name: Stripe-Signature
    format: 't={ts},v1={sig}'
    algorithm: hmac-sha256
    payload: '{ts}.{rawBody}'
    encoding: hex
    tolerance: 5m
    key: { value: stripe }
  githubSig:
    kind: signature
    name: X-Hub-Signature-256
    format: 'sha256={sig}'
    algorithm: hmac-sha256
    payload: '{rawBody}'
    encoding: hex
    key: { from: path.workspaceId }
  slackSig: { kind: signature, verify: application, name: X-Slack-Signature, headers: [X-Slack-Request-Timestamp] }
identities:
  viewer:
    schemes: { read: [session, bearer], write: [session, bearer], optionalRead: [device] }
    principal: Viewer
  plain:
    schemes: { read: [plainSession], write: [plainSession] }
    principal: Viewer
  reader:
    schemes: { read: [bearer, mapsKey], write: [] }
    principal: Viewer
  twoCookies:
    schemes: { read: [session, otherSession], write: [session, otherSession] }
    principal: Viewer
  stripe: { kind: signed, scheme: stripeSig, principal: Caller }
  github:
    kind: signed
    scheme: githubSig
    principal: Caller
    unknownKeys: { ignore: "GitHub adds payload fields without notice." }
  slack: { kind: signed, scheme: slackSig, principal: Caller }
schemas:
  Viewer: { type: object, required: [userId], properties: { userId: { type: string }, workspaceId: { type: string } } }
  Caller: { type: object, required: [account], properties: { account: { type: string } } }
  Event: { type: object, properties: { workspaceId: { type: string } } }
  Id: { type: string }
`;

const SCHEMAS = [
  accessIdentityObjectSchema("Viewer", { userId: STRING, workspaceId: STRING }),
  accessIdentityObjectSchema("Caller", { account: STRING }),
  accessIdentityObjectSchema("Event", { workspaceId: STRING }),
];

const ref = (schema: string): IrWriter.TypeUse => ({ kind: "ref", schema });

const PRINCIPALS: AccessIdentitySchemaUseRow[] = [
  { pointer: "/identities/viewer/principal", direction: "output", use: ref("Viewer") },
  { pointer: "/identities/plain/principal", direction: "output", use: ref("Viewer") },
  { pointer: "/identities/reader/principal", direction: "output", use: ref("Viewer") },
  { pointer: "/identities/twoCookies/principal", direction: "output", use: ref("Viewer") },
  ...["stripe", "github", "slack"].map((id) => ({
    pointer: `/identities/${id}/principal`,
    direction: "output" as const,
    use: ref("Caller"),
  })),
];

const PATH_STRING = (name: string, pointer: string): IrWriter.Param => ({
  name,
  type: STRING,
  required: true,
  origin: { layer: "api", pointer },
});

interface Compiled {
  draft: DraftIR;
  rules: string[];
  messages: string[];
  operation(id: string): DraftOperation;
}

// Compiles the base catalogues and `surfaces`; `inputs` answers each route input pointer with a use, and `prepare`
// stands in for params tree.nodes does not write yet.
function compile(
  surfaces: string,
  inputs: Record<string, IrWriter.TypeUse> = {},
  prepare?: (draft: DraftIR) => void,
  api = API,
): Compiled {
  const rows: AccessIdentitySchemaUseRow[] = [
    ...PRINCIPALS,
    ...Object.entries(inputs).map(([pointer, use]) => ({
      pointer,
      direction: "input" as const,
      use,
    })),
  ];
  const { draft, diagnostics } = accessIdentityRoutesRun(
    accessIdentityInline(`${api}\n${BASE}surfaces:\n${surfaces}`),
    accessIdentityDraft(SCHEMAS),
    accessIdentityTableService(rows, { "/schemas/Event/properties/workspaceId": TEXT_WIRE }),
    prepare,
  );
  return {
    draft,
    rules: diagnostics.map((diagnostic) => diagnostic.rule),
    messages: diagnostics.map((diagnostic) => diagnostic.message),
    operation: (id) => {
      const found = draft.operations.find((operation) => operation.id === id);
      if (found === undefined) throw new Error(`no operation ${id}`);
      return found;
    },
  };
}

const access = (id: string, compiled: Compiled) => {
  const { access: written, callerKinds, csrf } = compiled.operation(id);
  return { access: written, callerKinds, csrf };
};

describe("access.identity per operation on the routes fixture", () => {
  test("every operation gets the members of operations.json and the draft fits its form", () => {
    const { draft, diagnostics } = accessIdentityRoutesFixtureRun();
    expect(diagnostics).toEqual([]);

    const written = Object.fromEntries(
      draft.operations.map((operation) => {
        const { access, callerKinds, csrf, principalRequires, bindings, input } = operation;
        const unknownKeys = input?.schema.kind === "ref" ? input.schema.unknownKeys : undefined;
        const inputFacts =
          input === undefined
            ? {}
            : {
                input: {
                  rawBody: input.rawBody,
                  ...(unknownKeys === undefined ? {} : { schema: { unknownKeys } }),
                },
              };
        const members = {
          access,
          callerKinds,
          ...(csrf === undefined ? {} : { csrf }),
          principalRequires,
          bindings,
        };
        return [operation.id, { ...members, ...inputFacts }];
      }),
    );
    expect(written).toEqual(accessIdentityFixtureJson("routes", "operations.json"));
    expect(createDraftValidator().validate(draft)).toMatchObject({ valid: true });
  });
});

describe("deny by default", () => {
  test("a route with neither identity nor public access is refused, naming both fixes", () => {
    const compiled = compile(`  app:
    routes:
      ping: { method: get, output: Event }
`);
    expect(compiled.rules).toEqual(["seampact/access/deny-by-default"]);
    expect(compiled.messages[0]).toContain("route 'ping' has no identity and no public access");
    expect(compiled.operation("ping").access).toBeUndefined();
  });

  test("an identity on a parent identifies every route below it", () => {
    const compiled = compile(`  app:
    identity: viewer
    routes:
      ping: { method: get, output: Event }
`);
    expect(compiled.rules).toEqual([]);
    expect(access("ping", compiled)).toEqual({
      access: {
        kind: "identity",
        identity: "viewer",
        schemes: ["bearer", "session"],
        origin: { layer: "api", pointer: "/surfaces/app/identity" },
      },
      callerKinds: ["identified"],
      csrf: undefined,
    });
  });

  test("an undeclared identity is refused at the setting", () => {
    const compiled = compile(`  app:
    identity: nobody
    routes:
      ping: { method: get, output: Event }
      pong: { method: get, output: Event }
`);
    expect(compiled.rules).toEqual(["seampact/access/identity-reference"]);
  });

  test("an empty scheme list for the route's direction is refused, naming the identity's list", () => {
    const compiled = compile(`  app:
    identity: reader
    routes:
      ping: { method: get, output: Event }
      poke: { method: post, input: Event }
`);
    expect(compiled.rules).toEqual(["seampact/access/access-schemes"]);
    expect(compiled.messages[0]).toContain("route 'poke' is a write under identity 'reader'");
    expect(compiled.operation("ping").access).toMatchObject({ schemes: ["bearer", "mapsKey"] });
  });
});

describe("reasons on access exceptions", () => {
  test("a public route carries its reason, also under an identified parent", () => {
    const compiled = compile(`  app:
    identity: viewer
    routes:
      health:
        method: get
        access: { public: "Probes call it before any user exists." }
        output: Event
`);
    expect(compiled.rules).toEqual([]);
    expect(access("health", compiled)).toEqual({
      access: {
        kind: "public",
        reason: "Probes call it before any user exists.",
        origin: { layer: "api", pointer: "/surfaces/app/routes/health/access" },
      },
      callerKinds: ["anonymous"],
      csrf: undefined,
    });
  });

  test("an identity set below a public access makes the identity required again", () => {
    const compiled = compile(`  app:
    access: { public: "The whole surface is open." }
    identity: viewer
    routes:
      open: { method: get, output: Event }
      closed: { method: get, identity: viewer, output: Event }
`);
    expect(compiled.rules).toEqual([]);
    expect(compiled.operation("open").access?.kind).toBe("public");
    expect(compiled.operation("closed").access?.kind).toBe("identity");
  });

  test("a csrf exemption carries its reason", () => {
    const compiled = compile(`  app:
    identity: viewer
    routes:
      login:
        method: post
        csrf: { exempt: "The login form has no session yet." }
        input: Event
`);
    expect(compiled.rules).toEqual([]);
    expect(compiled.operation("login").csrf).toEqual({
      kind: "exempt",
      reason: "The login form has no session yet.",
      origin: { layer: "api", pointer: "/surfaces/app/routes/login/csrf" },
    });
  });
});

describe("optional access and onRefused", () => {
  const OPTIONAL = `  app:
    identity: viewer
    access: { optionalAuth: "Anonymous readers see public posts." }
    routes:
      feed: { method: get, output: Event }
      like: { method: post, input: Event }
      strict:
        method: get
        access: { optionalAuth: "A bad credential is an error here.", onRefused: reject }
        output: Event
`;

  test("a safe optional route takes read plus optionalRead, a write its write schemes only", () => {
    const compiled = compile(OPTIONAL);
    expect(compiled.rules).toEqual([]);
    expect(access("feed", compiled)).toEqual({
      access: {
        kind: "optional",
        identity: "viewer",
        schemes: ["bearer", "device", "session"],
        reason: "Anonymous readers see public posts.",
        onRefused: "anonymous",
        origin: { layer: "api", pointer: "/surfaces/app/access" },
      },
      callerKinds: ["anonymous", "identified"],
      csrf: undefined,
    });
    expect(compiled.operation("like").access).toMatchObject({ schemes: ["bearer", "session"] });
  });

  test("onRefused defaults to anonymous and keeps reject as written", () => {
    const compiled = compile(OPTIONAL);
    expect(compiled.operation("feed").access).toMatchObject({ onRefused: "anonymous" });
    expect(compiled.operation("strict").access).toMatchObject({ onRefused: "reject" });
  });

  test("optional access without an identity, or under a signed one, is refused", () => {
    const compiled = compile(`  app:
    access: { optionalAuth: "No identity to relax." }
    routes:
      feed: { method: get, output: Event }
  hooks:
    identity: stripe
    access: { optionalAuth: "A webhook is never anonymous." }
    routes:
      payments: { method: post, input: Event }
`);
    expect(compiled.rules).toEqual([
      "seampact/access/optional-identity",
      "seampact/access/signed-access",
    ]);
  });
});

describe("csrf derived on cookie writes", () => {
  test("derived on a write accepting a cookie with csrf, from the identity and the cookie", () => {
    const compiled = compile(`  app:
    identity: viewer
    routes:
      save: { method: post, input: Event }
`);
    expect(compiled.operation("save").csrf).toEqual({
      kind: "derived",
      header: "X-Csrf",
      derivedFrom: {
        derivation: "csrf.cookieWrite",
        from: [
          { layer: "api", pointer: "/identities/viewer" },
          { layer: "api", pointer: "/schemes/session" },
        ],
      },
    });
  });

  test("absent on a safe route, a batch read, a cookie without csrf and a signed route", () => {
    const compiled = compile(
      `  app:
    identity: viewer
    routes:
      read: { method: get, output: Event }
      items:
        kind: collection
        id: { itemId: Id }
        item: Event
        ops: { batch: { maxIds: 10 } }
  legacy:
    identity: plain
    routes:
      save: { method: post, input: Event }
  hooks:
    identity: stripe
    routes:
      payments: { method: post, input: Event }
`,
      { "/surfaces/app/routes/items/id/itemId": STRING },
    );
    expect(compiled.rules).toEqual([]);
    for (const id of ["read", "getItemsBatch", "save", "payments"])
      expect(compiled.operation(id).csrf).toBeUndefined();
  });

  test("cookie write schemes naming different csrf headers are refused", () => {
    const compiled = compile(`  app:
      identity: twoCookies
      routes:
        save: { method: post, input: Event }
  `);
    expect(compiled.rules).toEqual(["seampact/access/csrf-header"]);
    expect(compiled.operation("save").csrf).toBeUndefined();
  });
});

describe("signed identities", () => {
  test("access is the identity with its one signature scheme; the declared input reads the raw body", () => {
    const compiled = compile(
      `  hooks:
    identity: stripe
    routes:
      payments: { method: post, input: Event }
`,
      { "/surfaces/hooks/routes/payments/input": ref("Event") },
    );
    expect(compiled.rules).toEqual([]);
    const payments = compiled.operation("payments");
    expect(payments.access).toEqual({
      kind: "identity",
      identity: "stripe",
      schemes: ["stripeSig"],
      origin: { layer: "api", pointer: "/surfaces/hooks/identity" },
    });
    expect(payments.callerKinds).toEqual(["identified"]);
    expect(payments.csrf).toBeUndefined();
    expect(payments.input).toMatchObject({
      rawBody: true,
      schema: { kind: "ref", schema: "Event" },
    });
    expect(payments.input?.schema).not.toHaveProperty("unknownKeys");
  });

  test("the identity's unknownKeys reaches a ref input that sets none, with derivedFrom", () => {
    const compiled = compile(
      `  hooks:
    identity: github
    routes:
      push:
        path: /push/{workspaceId}
        method: post
        input: Event
`,
      { "/surfaces/hooks/routes/push/input": ref("Event") },
      (draft) => withPathParam(draft, "push", "workspaceId"),
    );
    expect(compiled.rules).toEqual([]);
    expect(compiled.operation("push").input?.schema).toEqual({
      kind: "ref",
      schema: "Event",
      unknownKeys: {
        policy: "ignore",
        reason: "GitHub adds payload fields without notice.",
        derivedFrom: {
          derivation: "identity.unknownKeys",
          from: [{ layer: "api", pointer: "/identities/github" }],
        },
      },
    });
  });

  test("a use's own unknownKeys is kept, and an opaque input gets none", () => {
    const own: IrWriter.TypeUse = {
      kind: "ref",
      schema: "Event",
      unknownKeys: { policy: "refuse", reason: "Strict events." },
    };
    const opaque: IrWriter.TypeUse = {
      kind: "opaque",
      reason: "Raw bytes.",
      origin: { layer: "api", pointer: "/surfaces/hooks/routes/blob/input" },
    };
    const compiled = compile(
      `  hooks:
    identity: github
    routes:
      strict: { path: '/strict/{workspaceId}', method: post, input: Event }
      blob: { path: '/blob/{workspaceId}', method: post, input: Event }
`,
      { "/surfaces/hooks/routes/strict/input": own, "/surfaces/hooks/routes/blob/input": opaque },
      (draft) => {
        withPathParam(draft, "strict", "workspaceId");
        withPathParam(draft, "blob", "workspaceId");
      },
    );
    expect(compiled.rules).toEqual([]);
    expect(compiled.operation("strict").input?.schema).toEqual(own);
    expect(compiled.operation("blob").input).toMatchObject({ rawBody: true, schema: opaque });
  });

  test("a signed route without input gets no input", () => {
    const compiled = compile(`  hooks:
    identity: stripe
    routes:
      ping: { method: post }
`);
    expect(compiled.rules).toEqual([]);
    expect(compiled.operation("ping").input).toBeUndefined();
  });

  test("every route of the identity carries the key source", () => {
    const compiled = compile(
      `  hooks:
    identity: github
    routes:
      push: { path: '/push/{workspaceId}', method: post, input: Event }
      ping: { method: post, input: Event }
`,
      {},
      (draft) => withPathParam(draft, "push", "workspaceId"),
    );
    expect(compiled.rules).toEqual(["seampact/access/signature-key-source"]);
    expect(compiled.messages[0]).toContain(
      "route 'ping' under signed identity 'github' has no path parameter 'workspaceId'",
    );
  });

  test("an application-verified form webhook reads the raw body of its form input", () => {
    const form: IrWriter.TypeUse = ref("Event");
    const compiled = compile(
      `  hooks:
    identity: slack
    routes:
      commands:
        method: post
        inputMedia: form
        input: Event
`,
      { "/surfaces/hooks/routes/commands/input": form },
    );
    expect(compiled.rules).toEqual([]);
    expect(compiled.operation("commands").access).toMatchObject({ schemes: ["slackSig"] });
    expect(compiled.operation("commands").input).toMatchObject({ rawBody: true });
  });
});

describe("raw body on every declared input", () => {
  test("false off signed routes, and no input created where tree.nodes wrote none", () => {
    const compiled = compile(
      `  app:
    identity: viewer
    routes:
      save: { method: post, input: Event }
      read: { method: get, output: Event }
`,
      { "/surfaces/app/routes/save/input": ref("Event") },
    );
    expect(compiled.operation("save").input).toMatchObject({ rawBody: false });
    expect(compiled.operation("save").input?.schema).toEqual(ref("Event"));
    expect(compiled.operation("read").input).toBeUndefined();
  });
});

describe("security schemes", () => {
  test("a query scheme's parameter is never a declared query field of a route accepting it", () => {
    const compiled = compile(
      `  app:
    identity: reader
    routes:
      tiles: { method: get, output: Event }
`,
      {},
      (draft) => withQueryParam(draft, "tiles", "key"),
    );
    expect(compiled.rules).toEqual(["seampact/access/scheme-query-field"]);
    expect(compiled.messages[0]).toContain("route 'tiles' declares query field 'key'");
  });
});

describe("principal requires and bindings", () => {
  test("requires and bindings are checked against the principal and the route", () => {
    const compiled = compile(
      `  app:
    identity: viewer
    principal: { requires: [workspaceId] }
    routes:
      save:
        path: '/w/{workspaceId}'
        method: post
        input: Event
        bindings: { path.workspaceId: principal.workspaceId, body.workspaceId: principal.workspaceId }
`,
      { "/surfaces/app/routes/save/input": ref("Event") },
      (draft) => withPathParam(draft, "save", "workspaceId"),
    );
    expect(compiled.rules).toEqual([]);
    const save = compiled.operation("save");
    expect(save.principalRequires).toEqual([
      {
        field: "workspaceId",
        origin: { layer: "api", pointer: "/surfaces/app/principal/requires/0" },
      },
    ]);
    expect(save.bindings).toEqual([
      {
        from: { in: "body", name: "workspaceId" },
        to: { in: "principal", name: "workspaceId" },
        origin: { layer: "api", pointer: "/surfaces/app/routes/save/bindings/body.workspaceId" },
      },
      {
        from: { in: "path", name: "workspaceId" },
        to: { in: "principal", name: "workspaceId" },
        origin: { layer: "api", pointer: "/surfaces/app/routes/save/bindings/path.workspaceId" },
      },
    ]);
  });

  test("a missing principal field, an absent source and a key bound twice are refused", () => {
    const compiled = compile(
      `  app:
    identity: viewer
    principal: { requires: [teamId] }
    bindings: { query.owner: principal.userId }
    routes:
      save:
        method: post
        input: Event
        bindings: { query.owner: principal.workspaceId, body.missing: principal.userId }
`,
      { "/surfaces/app/routes/save/input": ref("Event") },
    );
    expect(compiled.rules).toEqual([
      "seampact/access/principal-field",
      "seampact/access/binding-source",
      "seampact/access/binding-conflict",
      "seampact/access/binding-source",
    ]);
  });

  test("a key bound again to the same field below keeps the first binding", () => {
    const compiled = compile(
      `  app:
    identity: viewer
    bindings: { body.workspaceId: principal.workspaceId }
    routes:
      save:
        method: post
        input: Event
        bindings: { body.workspaceId: principal.workspaceId }
`,
      { "/surfaces/app/routes/save/input": ref("Event") },
    );
    expect(compiled.rules).toEqual([]);
    expect(compiled.operation("save").bindings).toEqual([
      {
        from: { in: "body", name: "workspaceId" },
        to: { in: "principal", name: "workspaceId" },
        origin: { layer: "api", pointer: "/surfaces/app/bindings/body.workspaceId" },
      },
    ]);
  });

  test("a principal field read on a public route is refused", () => {
    const compiled = compile(`  app:
    routes:
      health:
        method: get
        access: { public: "Probes." }
        principal: { requires: [userId] }
        output: Event
`);
    expect(compiled.rules).toEqual(["seampact/access/principal-field"]);
  });
});

describe("service api identity", () => {
  test("every route runs under the caller identity, which surfaces need not repeat", () => {
    const compiled = compile(
      `  internal:
    routes:
      ping: { method: get, output: Event }
      again: { method: get, identity: viewer, output: Event }
`,
      {},
      undefined,
      SERVICE_API,
    );
    expect(compiled.rules).toEqual([]);
    expect(compiled.operation("ping").access).toEqual({
      kind: "identity",
      identity: "viewer",
      schemes: ["bearer", "session"],
      origin: { layer: "api", pointer: "/api/caller/identity" },
    });
    expect(compiled.operation("again").access).toMatchObject({
      origin: { layer: "api", pointer: "/surfaces/internal/routes/again/identity" },
    });
  });

  test("another identity, a public route and an optional-auth route are refused", () => {
    const compiled = compile(
      `  internal:
    routes:
      other: { method: get, identity: plain, output: Event }
      open: { method: get, access: { public: "Probes." }, output: Event }
      relaxed: { method: get, access: { optionalAuth: "Maybe." }, output: Event }
`,
      {},
      undefined,
      SERVICE_API,
    );
    expect(compiled.rules).toEqual([
      "seampact/access/service-identity",
      "seampact/access/service-access",
      "seampact/access/service-access",
    ]);
    expect(compiled.operation("other").access).toBeUndefined();
  });
});

describe("access.identity diagnostics are located", () => {
  test("a per-operation diagnostic names its rule and fix, resolves, and a conflict names both sides", () => {
    const contract = accessIdentityInline(`${API}
${BASE}surfaces:
  app:
    identity: viewer
    bindings: { query.owner: principal.userId }
    routes:
      save:
        method: post
        input: Event
        bindings: { query.owner: principal.workspaceId }
      ping: { method: get, identity: nobody, output: Event }
`);
    const { diagnostics } = accessIdentityRoutesRun(
      contract,
      accessIdentityDraft(SCHEMAS),
      accessIdentityTableService([
        ...PRINCIPALS,
        { pointer: "/surfaces/app/routes/save/input", direction: "input", use: ref("Event") },
      ]),
      (draft) => withQueryParam(draft, "save", "owner"),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "seampact/access/binding-conflict",
      "seampact/access/identity-reference",
    ]);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.fix).not.toBe("");
      expect(diagnostic.origin.layer).toBe("api");
    }
    expect(diagnostics[0]?.origin.pointer).toBe("/surfaces/app/routes/save/bindings/query.owner");
    expect(diagnostics[0]?.related.map((item) => item.origin.pointer)).toEqual([
      "/surfaces/app/bindings/query.owner",
    ]);
    expect(diagnostics[1]?.origin.pointer).toBe("/surfaces/app/routes/ping/identity");
  });
});

function withPathParam(draft: DraftIR, id: string, name: string): void {
  const operation = draft.operations.find((item) => item.id === id);
  if (operation === undefined) throw new Error(`no operation ${id}`);
  const params = operation.params ?? { path: [], query: [], header: [] };
  params.path.push(PATH_STRING(name, `/routes/${id}`));
  operation.params = params;
}

function withQueryParam(draft: DraftIR, id: string, name: string): void {
  const operation = draft.operations.find((item) => item.id === id);
  if (operation === undefined) throw new Error(`no operation ${id}`);
  const params = operation.params ?? { path: [], query: [], header: [] };
  params.query.push({ ...PATH_STRING(name, `/routes/${id}`), required: false });
  operation.params = params;
}
