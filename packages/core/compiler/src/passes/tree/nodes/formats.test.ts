import type { IrWriter } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import {
  TREE_NODES_FIXTURES,
  treeNodesApiOf,
  treeNodesDraftWith,
  treeNodesLoadDirectory,
  treeNodesLoadInline,
  treeNodesObjectSchema,
  treeNodesRun,
  treeNodesStubService,
  treeNodesUnansweredAt,
} from "./test-support.js";

// Every declared wire format and paging style (ADR 0002 sections 13 and 14, ADR 0004 section 8), their
// templates read against the slot catalogue and checked against each operation's payload.

const ROUTES = "/surfaces/app/routes";
const text: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };
const ref = (schema: string): IrWriter.TypeUse => ({ kind: "ref", schema });
const slot = (name: string, path: string[] = []): IrWriter.Template => ({
  kind: "slot",
  slot: name,
  path,
});
const member = (name: string, value: IrWriter.Template): IrWriter.ObjectTemplateMember => ({
  name: { kind: "text", text: name },
  value,
});
const NOTE = treeNodesObjectSchema("Note", "/schemas/Note", { noteId: text, text });

function run(
  apiYaml: string,
  uses: Record<string, IrWriter.TypeUse>,
  ...unanswered: readonly string[]
) {
  const workspace = treeNodesLoadInline(apiYaml);

  return treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas: treeNodesUnansweredAt(treeNodesStubService({ typeUses: uses }), ...unanswered),
    draft: treeNodesDraftWith(structuredClone(NOTE)),
  });
}

test("formats and paging styles: bare from the core where undeclared, every declared format and style compiled, used or not", () => {
  const { draft, diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
conventions:
  paging: { default: cursor, maxLimit: 50 }
schemas:
  Note: { type: object, properties: { noteId: { type: string }, text: { type: string } } }
formats:
  envelope:
    media: application/vnd.acme+json
    absent: null
    success:
      item: { body: { data: $payload, self: '/notes/\${id}', price: '$$5', meta: $meta }, headers: { X-Kind: $resource } }
      page: { body: { data: { $each: $items, $as: { id: $itemId, $merge: $itemFields } }, total: 3 } }
    meta:
      servedAt: { fill: now }
      degraded: { fill: degraded }
  spare: {}
pagings:
  cursor:
    request: { cursor: { query: cursor }, limit: { query: limit }, sort: { query: sort, style: signed } }
    response: { body: $items, links: { next: $next, prev: $previous } }
  unused:
    request: { page: { query: page } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note }
      notes:
        kind: collection
        format: envelope
        id: { noteId: { type: string } }
        item: Note
        ops: [list, get]
`,
    {
      [`${ROUTES}/health/output`]: ref("Note"),
      [`${ROUTES}/notes/id/noteId`]: text,
      [`${ROUTES}/notes/item`]: ref("Note"),
    },
  );

  expect(diagnostics).toEqual([]);
  expect(Object.keys(draft.formats)).toEqual(["bare", "envelope", "spare"]);
  expect(draft.formats.bare?.origin).toEqual({ layer: "core", pointer: "/formats/bare" });
  expect(draft.formats.envelope).toEqual({
    id: "envelope",
    origin: { layer: "api", pointer: "/formats/envelope" },
    media: "application/vnd.acme+json",
    absent: "null",
    success: {
      item: {
        body: {
          kind: "object",
          members: [
            member("data", slot("payload")),
            member("self", {
              kind: "text",
              parts: [
                { kind: "text", text: "/notes/" },
                { kind: "slot", slot: "id", path: [] },
              ],
            }),
            member("price", { kind: "literal", value: "$5" }),
            member("meta", slot("meta")),
          ],
        },
        headers: [{ name: "X-Kind", value: slot("resource") }],
      },
      table: { body: slot("payload"), headers: [] },
      list: { body: slot("payload"), headers: [] },
      page: {
        body: {
          kind: "object",
          members: [
            member("data", {
              kind: "each",
              of: "items",
              as: { kind: "object", members: [member("id", slot("itemId"))], merge: "itemFields" },
            }),
            member("total", { kind: "literal", value: 3 }),
          ],
        },
        headers: [],
      },
    },
    meta: {
      servedAt: {
        type: { kind: "scalar", type: "string", format: "date-time", refinements: {} },
        fill: "now",
      },
      degraded: { type: { kind: "scalar", type: "boolean", refinements: {} }, fill: "degraded" },
    },
    // A format without error takes the bare one.
    error: draft.formats.bare?.error,
  });
  expect(Object.keys(draft.pagings)).toEqual(["cursor", "unused"]);
  expect(draft.pagings.cursor).toEqual({
    id: "cursor",
    origin: { layer: "api", pointer: "/pagings/cursor" },
    position: "cursor",
    absent: "omit",
    request: [
      { role: "cursor", in: "query", name: "cursor" },
      { role: "limit", in: "query", name: "limit" },
      { role: "sort", in: "query", name: "sort", style: "signed" },
    ],
    response: {
      body: slot("items"),
      meta: [],
      headers: [],
      links: [
        { rel: "next", role: "next" },
        { rel: "prev", role: "previous" },
      ],
    },
    handlerResult: ["nextCursor", "previousCursor"],
  });
});

test("formats and paging styles: a declared bare replaces the core one, its error kept by the formats without one", () => {
  const { draft, diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
formats:
  bare:
    error: { media: application/json, body: { error: $code, details: $params } }
  wrapped:
    success: { item: { body: { data: $payload } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note }
      wrapped: { method: get, output: Note, format: wrapped }
`,
    { [`${ROUTES}/health/output`]: ref("Note"), [`${ROUTES}/wrapped/output`]: ref("Note") },
  );
  const declaredError: IrWriter.ErrorShape = {
    media: "application/json",
    body: {
      kind: "object",
      members: [member("error", slot("code")), member("details", slot("params"))],
    },
    headers: [],
  };

  expect(diagnostics).toEqual([]);
  expect(draft.formats.bare).toMatchObject({
    origin: { layer: "api", pointer: "/formats/bare" },
    media: "application/json",
    error: declaredError,
  });
  expect(draft.formats.wrapped?.error).toEqual(declaredError);
});

test("formats and paging styles: the handler result follows the roles each style writes", () => {
  const styles = {
    pages: `{ request: { page: { query: page } }, response: { meta: { page: $page, next: $next } } }`,
    counted: `{ request: { offset: { query: skip } }, response: { headers: { X-Total-Count: $totalPages } } }`,
    changes: `{ request: { since: { query: since } }, response: { body: { items: $items, done: $complete }, links: { next: $next } } }`,
    stripe: `{ request: { after: { query: starting_after }, before: { query: ending_before } }, response: { body: { data: $items, has_more: $more } } }`,
    github: `{ request: { page: { query: page, base: 0 }, sort: { query: sort, style: split, direction: direction } }, response: { links: { last: $last } } }`,
  };
  const routes = Object.keys(styles)
    .map(
      (style) => `      ${style}: { method: get, item: Note, paging: ${style}, format: enveloped }`,
    )
    .join("\n");
  const { draft, diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
conventions:
  paging: { maxLimit: 50 }
formats:
  enveloped:
    success: { page: { body: { data: $items, meta: $meta } } }
pagings:
${Object.entries(styles)
  .map(([style, written]) => `  ${style}: ${written}`)
  .join("\n")}
surfaces:
  app:
    prefix: /v{version}
    routes:
${routes}
`,
    Object.fromEntries(
      Object.keys(styles).map((style) => [`${ROUTES}/${style}/item`, ref("Note")]),
    ),
  );
  const style = (id: string) => draft.pagings[id];

  expect(diagnostics).toEqual([]);
  expect(style("pages")).toMatchObject({
    position: "page",
    request: [{ role: "page", in: "query", name: "page", base: 1 }],
    handlerResult: ["more"],
  });
  expect(style("pages")?.response.meta.map(({ name }) => name)).toEqual(["page", "next"]);
  expect(style("counted")).toMatchObject({ position: "offset", handlerResult: ["total"] });
  expect(style("changes")).toMatchObject({
    position: "since",
    handlerResult: ["nextSince", "complete"],
  });
  expect(style("stripe")).toMatchObject({ position: "cursor", handlerResult: ["more"] });
  expect(style("github")).toMatchObject({
    position: "page",
    request: [
      { role: "page", in: "query", name: "page", base: 0 },
      { role: "sort", in: "query", name: "sort", style: "split", direction: "direction" },
    ],
    handlerResult: ["total"],
  });
});

test("tree.nodes diagnostics are located: formats and paging styles", () => {
  const workspace = treeNodesLoadDirectory(`${TREE_NODES_FIXTURES}formats-refused/`);
  const raw = treeNodesApiOf(workspace);
  const uses: Record<string, IrWriter.TypeUse> = {
    [`${ROUTES}/text/output`]: text,
    [`${ROUTES}/am/output`]: { kind: "array", items: ref("Note") },
  };

  for (const route of [
    "slotted",
    "broken",
    "untyped",
    "codeless",
    "ided",
    "merged",
    "malformed",
    "leaky",
    "im",
  ])
    uses[`${ROUTES}/${route}/output`] = ref("Note");

  for (const route of [
    "twice",
    "nameless",
    "split",
    "itemless",
    "misfit",
    "linked",
    "metaed",
    "clashing",
    "lm",
    "idless",
  ])
    uses[`${ROUTES}/${route}/item`] = ref("Note");

  const draft = treeNodesDraftWith(
    treeNodesObjectSchema("Note", "/schemas/Note", { kind: text, text }),
  );
  const { diagnostics } = treeNodesRun(raw, workspace, {
    treeSchemas: treeNodesStubService({ typeUses: uses }),
    draft,
  });

  // Every rule once at least, each at the pointer that writes the refused value.
  expect(
    diagnostics.map(({ rule, origin, related }) => [
      rule.replace("seampact/tree/", ""),
      origin.pointer,
      ...related.map((location) => location.origin.pointer),
    ]),
  ).toEqual([
    ["template-slot", "/formats/slotted/success/item/body/code"],
    ["template-syntax", "/formats/broken/success/list/body"],
    ["format-meta", "/formats/untyped/meta/user"],
    ["format-error-code", "/formats/codeless/error"],
    ["template-syntax", "/formats/malformed/success/item/body"],
    ["template-syntax", "/formats/malformed/success/table/body/$merge"],
    ["template-syntax", "/formats/malformed/success/list/body/$bad.key"],
    ["template-slot", "/formats/leaky/error/body/data"],
    ["template-merge", "/formats/statusMerge/success/item/body/$merge"],
    ["template-each", "/formats/eachMeta/success/item/body/$each"],
    ["template-name", "/formats/payloadKey/success/item/body/$payload"],
    // A format no route uses is compiled too.
    ["template-slot", "/formats/unusedBad/success/item/body"],
    ["paging-reserved", "/pagings/none"],
    ["paging-position", "/pagings/twice/request"],
    ["paging-request", "/pagings/nameless/request/cursor"],
    ["paging-request", "/pagings/split/request/sort"],
    ["paging-items", "/pagings/itemless/response/body"],
    ["paging-role", "/pagings/misfit/response"],
    ["paging-link", "/pagings/linked/response/links/next"],
    ["paging-request", "/pagings/keyed/request/sort"],
    ["paging-request", "/pagings/directed/request/sort"],
    ["paging-position", "/pagings/half/request"],
    ["template-slot", "/pagings/headed/response/headers/X-Code"],
    ["paging-position", "/pagings/bodiless"],
    ["paging-request", "/pagings/dup/request/limit"],
    ["paging-role", "/pagings/sinceprev/response"],
    // A style no route uses is compiled too.
    ["paging-position", "/pagings/unusedBadStyle/request"],
    ["paging-meta", "/pagings/metaed/response/meta"],
    [
      "paging-meta-clash",
      "/pagings/clashing/response/meta/servedAt",
      "/formats/stamped/meta/servedAt",
    ],
    ["format-id", `${ROUTES}/ided`, "/formats/ided"],
    ["format-merge", `${ROUTES}/merged`, "/formats/merged"],
    ["format-merge", `${ROUTES}/text`, "/formats/merged"],
    ["format-merge", `${ROUTES}/lm`, "/formats/listMerge"],
    ["format-merge", `${ROUTES}/am`, "/formats/arrMerge"],
    ["format-each", `${ROUTES}/im`, "/formats/itemMap"],
    ["format-id", `${ROUTES}/idless`, "/pagings/idless"],
  ]);

  for (const diagnostic of diagnostics) {
    expect(diagnostic.message.endsWith(".")).toBe(true);
    expect(diagnostic.fix).not.toBe("");

    for (const origin of [
      diagnostic.origin,
      ...diagnostic.related.map((location) => location.origin),
    ])
      expect(Object.hasOwn(raw.locations, diagnosticLocationKey(origin))).toBe(true);
  }
});

test("formats and paging styles: name slots, sequences, escaped keys, typed meta fields and error headers", () => {
  const meta = "/formats/house/meta";
  const { draft, diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
formats:
  house:
    success:
      table: { body: { $collection: $payload, $$schema: [1, $status] } }
    meta:
      region: { fill: handler, schema: { type: string } }
      user: { fill: principal.account.id, schema: { type: string } }
    error: { body: { code: $code }, headers: { X-Error: '\${code}' } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note, format: house }
`,
    {
      [`${ROUTES}/health/output`]: ref("Note"),
      [`${meta}/region/schema`]: text,
      [`${meta}/user/schema`]: text,
    },
  );
  const house = draft.formats.house;

  expect(diagnostics).toEqual([]);
  expect(house?.success.table.body).toEqual({
    kind: "object",
    members: [
      { name: { kind: "slot", slot: "collection" }, value: slot("payload") },
      member("$schema", {
        kind: "array",
        items: [{ kind: "literal", value: 1 }, slot("status")],
      }),
    ],
  });
  expect(house?.meta).toEqual({
    region: { type: text, fill: "handler" },
    user: { type: text, fill: "source", source: { in: "principal", name: "account.id" } },
  });
  expect(house?.error).toEqual({
    media: "application/json",
    body: { kind: "object", members: [member("code", slot("code"))] },
    headers: [
      {
        name: "X-Error",
        value: { kind: "text", parts: [{ kind: "slot", slot: "code", path: [] }] },
      },
    ],
  });
});

test("formats and paging styles: a refused bare leaves the formats taking its error unwritten, reported once", () => {
  const { draft, diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
formats:
  bare:
    error: { body: { message: $title } }
  wrapped:
    success: { item: { body: { data: $payload } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note }
      wrapped: { method: get, output: Note, format: wrapped }
`,
    { [`${ROUTES}/health/output`]: ref("Note"), [`${ROUTES}/wrapped/output`]: ref("Note") },
  );

  expect(diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
    ["seampact/tree/format-error-code", "/formats/bare/error"],
  ]);
  expect(Object.keys(draft.formats)).toEqual([]);
});

test("formats and paging styles: a meta schema tree.schemas does not answer is an internal fault", () => {
  expect(() =>
    run(
      `
api: { name: a, version: 1, kind: product }
formats:
  house:
    meta: { region: { fill: handler, schema: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note, format: house }
`,
      { [`${ROUTES}/health/output`]: ref("Note") },
      "/formats/house/meta/region/schema",
    ),
  ).toThrow("the schema service answers no output type at /formats/house/meta/region/schema");
});

const located = (diagnostics: readonly { rule: string; origin: { pointer: string } }[]) =>
  diagnostics.map(({ rule, origin }) => [rule.replace("seampact/tree/", ""), origin.pointer]);

test("formats and paging styles: a sort role without style sends signed, and a header role is read", () => {
  const { draft, diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
pagings:
  headed:
    request: { cursor: { header: X-Cursor }, limit: { query: limit }, sort: { query: sort } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note }
`,
    { [`${ROUTES}/health/output`]: ref("Note") },
  );

  expect(diagnostics).toEqual([]);
  expect(draft.pagings.headed?.request).toEqual([
    { role: "cursor", in: "header", name: "X-Cursor" },
    { role: "limit", in: "query", name: "limit" },
    { role: "sort", in: "query", name: "sort", style: "signed" },
  ]);
});

test("formats and paging styles: two request roles on one header or one direction parameter are refused", () => {
  const { draft, diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
pagings:
  headers:
    request: { cursor: { header: X-Page }, limit: { header: x-page } }
  directed:
    request: { page: { query: page }, sort: { query: sort, style: split, direction: page } }
  same:
    request: { page: { query: page }, sort: { query: s, style: split, direction: s } }
  apart:
    request: { cursor: { header: x }, limit: { query: x } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note }
`,
    { [`${ROUTES}/health/output`]: ref("Note") },
  );

  expect(located(diagnostics)).toEqual([
    ["paging-request", "/pagings/headers/request/limit"],
    ["paging-request", "/pagings/directed/request/sort"],
    ["paging-request", "/pagings/same/request/sort"],
  ]);
  expect(Object.keys(draft.pagings)).toEqual(["apart"]);
});

test("formats and paging styles: a url or a number slot may not name a member", () => {
  const { diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
pagings:
  nk:
    request: { cursor: { query: cursor } }
    response: { body: { $next: $items } }
  pb:
    request: { page: { query: page } }
    response: { body: { $status: $total, data: $items } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note }
`,
    { [`${ROUTES}/health/output`]: ref("Note") },
  );

  expect(located(diagnostics)).toEqual([
    ["template-name", "/pagings/nk/response/body/$next"],
    ["template-name", "/pagings/pb/response/body/$status"],
  ]);
});

test("formats and paging styles: an error with headers but no body writes no $code", () => {
  const { diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
formats:
  headless:
    error: { headers: { X-Error: '\${code}' } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note }
`,
    { [`${ROUTES}/health/output`]: ref("Note") },
  );

  expect(located(diagnostics)).toEqual([["format-error-code", "/formats/headless/error"]]);
});

test("formats and paging styles: a merge inside $as is checked against the record, without its id member", () => {
  const { diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
conventions:
  paging: { default: cursor, maxLimit: 50 }
formats:
  spread:
    success: { page: { body: { data: { $each: $items, $as: { noteId: 1, text: 2, $merge: $itemFields } } } } }
pagings:
  cursor:
    request: { cursor: { query: cursor } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      notes:
        kind: collection
        format: spread
        id: { noteId: { type: string } }
        item: Note
        ops: [list]
`,
    { [`${ROUTES}/notes/id/noteId`]: text, [`${ROUTES}/notes/item`]: ref("Note") },
  );

  expect(diagnostics.map(({ rule, message }) => [rule, message])).toEqual([
    [
      "seampact/tree/format-merge",
      "The template of the format spread writes the member 'text', which the merged $itemFields of listNotes defines too.",
    ],
  ]);
});

test("formats and paging styles: $self on a collection item reads its id, and a fault two responses share is reported once", () => {
  const { diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
formats:
  selfed:
    success: { item: { body: { href: $self, data: $payload } } }
  ided:
    success: { item: { body: { id: $id } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note, format: selfed }
      twice:
        method: get
        format: ided
        responses: { 200: { body: Note }, 201: { body: Note } }
      notes:
        kind: collection
        format: selfed
        id: { noteId: { type: string } }
        idProperty: missing
        item: Note
        ops: [get]
`,
    {
      [`${ROUTES}/health/output`]: ref("Note"),
      [`${ROUTES}/twice/responses/200/body`]: ref("Note"),
      [`${ROUTES}/twice/responses/201/body`]: ref("Note"),
      [`${ROUTES}/notes/id/noteId`]: text,
      [`${ROUTES}/notes/item`]: ref("Note"),
    },
  );

  expect(located(diagnostics).filter(([rule]) => rule === "format-id")).toEqual([
    ["format-id", `${ROUTES}/twice`],
    ["format-id", `${ROUTES}/notes/ops/0`],
  ]);
});

test("formats and paging styles: a table payload merges without a clash check, and $fields leaves out the id member", () => {
  const notes = `${ROUTES}/notes`;
  const { draft, diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
conventions:
  batch: { maxIds: 20 }
formats:
  keyed:
    success:
      item: { body: { noteId: 1, $merge: $fields } }
      table: { body: { text: 1, $merge: $payload } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      notes:
        kind: collection
        format: keyed
        id: { noteId: { type: string } }
        item: Note
        ops: [get, batch]
`,
    {
      [`${notes}/id/noteId`]: text,
      [`${notes}/item`]: ref("Note"),
      [`${notes}/ops/1`]: ref("Note"),
    },
  );

  expect(diagnostics).toEqual([]);
  expect(
    draft.operations
      .flatMap((operation) => operation.responses ?? [])
      .map(({ shape }) => shape)
      .sort(),
  ).toEqual(["item", "table"]);
});

test("formats: $collection in an item names its collection, and a route outside any collection refuses it", () => {
  const { diagnostics } = run(
    `
api: { name: a, version: 1, kind: product }
formats:
  typed:
    success: { item: { body: { type: $collection, data: $payload } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health: { method: get, output: Note, format: typed }
      notes:
        kind: collection
        format: typed
        id: { noteId: { type: string } }
        item: Note
        ops: [get]
`,
    {
      [`${ROUTES}/health/output`]: ref("Note"),
      [`${ROUTES}/notes/id/noteId`]: text,
      [`${ROUTES}/notes/item`]: ref("Note"),
    },
  );

  expect(located(diagnostics)).toEqual([["template-slot", `${ROUTES}/health`]]);
});
