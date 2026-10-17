import { fileURLToPath } from "node:url";
import type { IrWriter, Origin } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { isDerivationId } from "../derivations/table.js";
import { diagnosticLocationKey } from "../diagnostics/print.js";
import { loadFsReader, loadWorkspace } from "../load/index.js";
import type { JsonObject, RawApi } from "../raw-tree.js";
import { createDraftIR, type DraftIR } from "./draft.js";
import {
  DRAFT_FIXTURE_INVALID_EXAMPLE,
  type DraftFixtureApi,
  draftFixture,
  draftFixtureApply,
  draftFixtureHalves,
  draftFixtureSchemaService,
  draftFixtureSchemaTables,
} from "./draft-fixture.js";
import { createDraftValidator } from "./draft-schema.js";
import { DraftAccessError, pipelineGuard } from "./guard.js";
import type { HalfName } from "./halves.js";
import {
  type DraftField,
  type OwnershipRow,
  pipelineContainers,
  pipelineOwnership,
} from "./ownership.js";
import { pipelineTreeNodes } from "./tree.js";

const REFERENCE = fileURLToPath(new URL("../../../../../fixtures/reference", import.meta.url));
const APIS: readonly DraftFixtureApi[] = ["tasks", "tasksService"];
const TREE_HALVES: readonly HalfName[] = ["tree.schemas", "tree.nodes"];
const ACCESS_HALVES: readonly HalfName[] = ["access.identity", "access.rights"];
const CORE_CATALOGUES = ["/formats/", "/errors/", "/schemas/"];

const loaded = loadWorkspace({ reader: loadFsReader(REFERENCE), entry: "workspace.yaml" });

function rawApi(name: string): RawApi {
  const api = loaded.workspace.apis.find((candidate) => candidate.name === name);

  if (api === undefined) throw new Error(`the reference contract has no api ${name}`);

  return api;
}

// Whether the ownership table lets `half` write a row.
function mayWrite(row: OwnershipRow, half: HalfName): boolean {
  if (row.mode === "owned") return row.owner === half;

  const writers: readonly HalfName[] =
    row.mode === "default" ? row.order : [row.declared, ...row.derived];

  return writers.includes(half);
}

// Every field the ownership table lets `half` write, with the containers it navigates through.
function writableFields(half: HalfName): DraftField[] {
  const rows = pipelineOwnership.filter((row) => mayWrite(row, half));

  return [...pipelineContainers, ...rows.map((row) => row.field)];
}

// Applies each half's members to `draft` under that half's guard, as the half itself would write them.
function applyGuarded(draft: DraftIR, api: DraftFixtureApi, file: "after-tree" | "access-delta") {
  for (const { half, members } of draftFixtureHalves(api, file)) {
    const guard = pipelineGuard(draft, {
      half,
      reads: ["operations[].id"],
      writes: writableFields(half),
    });

    try {
      draftFixtureApply(guard.draft, members);
    } finally {
      guard.dispose();
    }
  }
}

interface FoundOrigin {
  at: string;
  origin: Origin;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOrigin = (value: unknown): value is Origin =>
  isRecord(value) && typeof value.layer === "string" && typeof value.pointer === "string";

// Every value of `draft` with its path, depth first.
function walk(value: unknown, at: string, visit: (value: unknown, at: string) => void): void {
  visit(value, at);

  if (!Array.isArray(value) && !isRecord(value)) return;

  for (const [key, member] of Object.entries(value)) walk(member, `${at}/${key}`, visit);
}

function originsOf(draft: object): FoundOrigin[] {
  const found: FoundOrigin[] = [];

  walk(draft, "", (value, at) => {
    if (!isRecord(value)) return;

    for (const key of ["origin", "at"]) {
      const origin = value[key];

      if (isOrigin(origin)) found.push({ at: `${at}/${key}`, origin });
    }

    const derivedFrom = value.derivedFrom;

    if (!isRecord(derivedFrom) || !Array.isArray(derivedFrom.from)) return;

    for (const [index, origin] of Object.entries(derivedFrom.from))
      if (isOrigin(origin)) found.push({ at: `${at}/derivedFrom/from/${index}`, origin });
  });

  return found;
}

interface FoundElement {
  at: string;
  element: unknown;
}

// The lists a draft field names (`operations[].responses[].headers`), each `[]` segment walking every element.
function listsAt(value: unknown, segments: readonly string[], at: string): FoundElement[] {
  const [segment, ...rest] = segments;

  if (segment === undefined)
    return Array.isArray(value)
      ? value.map((element, position) => ({ at: `${at}/${position}`, element }))
      : [];

  const name = segment.replace(/\[\]$/, "");
  const member = isRecord(value) ? value[name] : undefined;

  if (name === segment) return listsAt(member, rest, `${at}/${name}`);

  if (!Array.isArray(member)) return [];

  return member.flatMap((element, position) => listsAt(element, rest, `${at}/${name}/${position}`));
}

// The elements of every `elements` list of the ownership table in `draft`.
function elementsOf(draft: DraftIR): FoundElement[] {
  return pipelineOwnership
    .filter((row) => row.mode === "elements")
    .flatMap((row) => listsAt(draft, row.field.split("."), ""));
}

// The restriction of the property a field-right pointer names (`/items/*/effort`), through refs and array items.
function restrictionOf(
  draft: DraftIR,
  schemaId: string,
  pointer: string,
): IrWriter.FieldRestriction | undefined {
  const [propertyName, ...rest] = pointer.split("/");
  const property = propertiesOf(draft, schemaId).find(({ name }) => name === propertyName);

  if (rest.length === 0 || property === undefined) return property?.restrictedTo;

  let type = property.type;

  while (type.kind === "array" && rest[0] === "*") {
    type = type.items;
    rest.shift();
  }

  return type.kind === "ref" ? restrictionOf(draft, type.schema, rest.join("/")) : undefined;
}

function propertiesOf(draft: DraftIR, schemaId: string) {
  const schema = draft.schemas[schemaId];

  return schema?.kind === "object" ? schema.properties : [];
}

// The operation ids whose `input.rawBody` a half's delta members write.
function rawBodyWriters(members: JsonObject | undefined): string[] {
  const operations = members?.operations;

  if (!isRecord(operations)) return [];

  return Object.entries(operations)
    .filter(([, entry]) => isRecord(entry) && isRecord(entry.input) && "rawBody" in entry.input)
    .map(([id]) => id);
}

// The value a JSON Pointer names inside `value`, undefined when a step is missing.
function valueAtPointer(value: unknown, pointer: string): unknown {
  let current = value;

  for (const segment of pointer.split("/").slice(1)) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");

    if (!Array.isArray(current) && !isRecord(current)) return undefined;
    current = Array.isArray(current) ? current[Number(key)] : current[key];
  }

  return current;
}

// Members of a schema position in an access catalogue: a type use, or a `SchemaRef` (right and rule params).
const SCHEMA_POSITION_KEYS = ["schema", "idSchema", "params"];

// Every type use tree.nodes writes from a schema written on a route: declared params, inputs and response bodies.
// Derived elements are not read through the service (a relay route copies them), and neither is a batch input,
// which tree.schemas builds from `ops.batch` rather than from a written schema. A declared response keeps its
// written body beside its `response.format` record.
function declaredRouteSchemaPositions(draft: DraftIR): string[] {
  return draft.operations.flatMap((operation, index) => {
    const base = `/operations/${index}`;
    const params = (["path", "query", "header"] as const).flatMap((kind) =>
      (operation.params?.[kind] ?? []).flatMap((param, position) =>
        param.derivedFrom === undefined ? [`${base}/params/${kind}/${position}/type`] : [],
      ),
    );
    const input =
      operation.input !== undefined && operation.op !== "batch" ? [`${base}/input/schema`] : [];
    const bodies = (operation.responses ?? []).flatMap((response, position) =>
      response.body !== undefined &&
      (response.derivedFrom === undefined || response.derivedFrom.derivation === "response.format")
        ? [`${base}/responses/${position}/body`]
        : [],
    );

    return [...params, ...input, ...bodies];
  });
}

// Every schema position the access delta writes outside operations, as JSON Pointers into the draft.
function accessCatalogueSchemaPositions(api: DraftFixtureApi): string[] {
  const positions: string[] = [];

  for (const { members } of draftFixtureHalves(api, "access-delta"))
    for (const [catalogue, entries] of Object.entries(members)) {
      if (catalogue === "operations") continue;
      walk(entries, `/${catalogue}`, (value, at) => {
        const key = at.slice(at.lastIndexOf("/") + 1);

        if (SCHEMA_POSITION_KEYS.includes(key) && (typeof value === "string" || isRecord(value)))
          positions.push(at);
      });
    }

  return positions;
}

describe("draft fixtures", () => {
  const validator = createDraftValidator();

  test.each(APIS)("%s: each fixture validates against the derived draft form", (api) => {
    for (const stage of ["after-tree", "after-access"] as const) {
      const report = validator.validate(draftFixture(api, stage));

      expect(report, `${api} ${stage}`).toMatchObject({
        valid: true,
        problems: [],
        unknownMembers: [],
      });
    }
  });

  test.each(APIS)(
    "%s: tree writes the after-tree draft and access the delta, as ownership allows",
    (api) => {
      const draft = createDraftIR();

      expect(draftFixtureHalves(api, "after-tree").map(({ half }) => half)).toEqual(TREE_HALVES);
      applyGuarded(draft, api, "after-tree");
      expect(draft).toEqual(draftFixture(api, "after-tree"));

      expect(draftFixtureHalves(api, "access-delta").map(({ half }) => half)).toEqual(
        ACCESS_HALVES,
      );
      applyGuarded(draft, api, "access-delta");
      expect(draft).toEqual(draftFixture(api, "after-access"));
    },
  );

  test("the ownership check refuses a member another half owns", () => {
    const draft = createDraftIR();
    const guard = pipelineGuard(draft, {
      half: "tree.nodes",
      reads: [],
      writes: writableFields("tree.nodes"),
    });

    expect(() => draftFixtureApply(guard.draft, { rights: { roles: {} } })).toThrow(
      DraftAccessError,
    );
    expect(() =>
      draftFixtureApply(guard.draft, { operations: [{ id: "getTask", requires: [] }] }),
    ).toThrow(/owner access\.rights/);
    guard.dispose();
  });

  test("draftFixtureApply adds members and never replaces one", () => {
    const draft = createDraftIR();

    draftFixtureApply(draft, { operations: [{ id: "getTask", params: { path: [] } }] });
    draftFixtureApply(draft, {
      operations: { getTask: { safe: true, params: { path: [{ name: "taskId" }] } } },
    });
    expect(draft.operations).toEqual([
      { id: "getTask", safe: true, params: { path: [{ name: "taskId" }] } },
    ]);
    expect(() => draftFixtureApply(draft, { operations: { getTask: { safe: false } } })).toThrow(
      /operations\.getTask\.safe is already set/,
    );
    expect(() => draftFixtureApply(draft, { operations: { listTasks: {} } })).toThrow(
      /operations\.listTasks names no element/,
    );
  });

  test.each(APIS)("%s: every origin resolves in its api's side table, but a core one", (api) => {
    const draft = draftFixture(api, "after-access");
    const origins = originsOf(draft);

    expect(origins.length).toBeGreaterThan(0);

    for (const { at, origin } of origins) {
      if (origin.layer === "core") {
        expect(
          CORE_CATALOGUES.some((catalogue) => origin.pointer.startsWith(catalogue)),
          at,
        ).toBe(true);
        continue;
      }

      const locations = rawApi(origin.api ?? api).locations;

      expect(
        Object.hasOwn(locations, diagnosticLocationKey(origin)),
        `${at}: ${diagnosticLocationKey(origin)}`,
      ).toBe(true);
    }
  });

  test.each(APIS)(
    "%s: every element is declared or derived, and each derivation is in the table",
    (api) => {
      const draft = draftFixture(api, "after-access");
      const elements = elementsOf(draft);

      expect(elements.length).toBeGreaterThan(draft.operations.length);

      for (const { at, element } of elements) {
        expect(isRecord(element), at).toBe(true);

        if (isRecord(element))
          expect(isOrigin(element.origin) || isRecord(element.derivedFrom), at).toBe(true);
      }

      walk(draft, "", (value, at) => {
        if (!isRecord(value) || !isRecord(value.derivedFrom)) return;
        const derivation = value.derivedFrom.derivation;

        expect(
          typeof derivation === "string" && isDerivationId(derivation),
          `${at}: ${String(derivation)}`,
        ).toBe(true);
      });
    },
  );

  test.each(APIS)(
    "%s: tree creates one operation per route, relay and op, with its lists",
    (api) => {
      const draft = draftFixture(api, "after-tree");
      const routes = pipelineTreeNodes(rawApi(api)).filter((node) =>
        ["route", "relay", "op"].includes(node.kind),
      );

      expect(draft.operations.map((operation) => operation.origin)).toEqual(
        routes.map((node) => node.origin),
      );

      for (const operation of draft.operations) {
        expect(operation.params, operation.id).toEqual({
          path: expect.any(Array),
          query: expect.any(Array),
          header: expect.any(Array),
        });
        expect(operation.responses, operation.id).toEqual(expect.any(Array));
      }
    },
  );

  // ADR 0004 section 13: the origin is the first requirement that brings a body proof.
  test("tasks: access.rights writes a proof-only input where tree left none", () => {
    const operationsWithoutInput = draftFixture("tasks", "after-tree")
      .operations.filter((operation) => operation.input === undefined)
      .map((operation) => operation.id);
    const proofOnlyInputs = draftFixture("tasks", "after-access").operations.filter(
      (operation) =>
        operationsWithoutInput.includes(operation.id) && operation.input?.proofs !== undefined,
    );

    expect(proofOnlyInputs.map((operation) => operation.id)).toEqual(["purgeTask"]);

    for (const { id, input } of proofOnlyInputs) {
      const firstProofOrigin = input?.proofs?.[0]?.derivedFrom.from?.[0];

      expect(input, id).toMatchObject({
        media: "application/json",
        schema: { kind: "ref", schema: "ApiEmptyBody" },
        rawBody: false,
      });
      expect(input?.origin, id).toEqual(firstProofOrigin);
    }
  });

  test("tasks: a restricted field or sort key derives from its property's restrictedTo", () => {
    const draft = draftFixture("tasks", "after-access");
    const checked: string[] = [];

    for (const operation of draft.operations) {
      for (const fieldRight of operation.fieldRights ?? []) {
        const restriction = restrictionOf(draft, fieldRight.schema, fieldRight.pointer.slice(1));

        expect(fieldRight.derivedFrom.from?.[0], operation.id).toEqual(restriction?.origin);
        checked.push(`${operation.id} ${fieldRight.schema}${fieldRight.pointer}`);
      }

      const item = operation.responses?.find((response) => response.body?.kind === "ref")?.body;

      for (const sortKey of operation.paging?.sortKeys ?? []) {
        if (sortKey.derivedFrom === undefined || item?.kind !== "ref") continue;
        const restriction = restrictionOf(draft, item.schema, sortKey.key);

        expect(sortKey.derivedFrom.from?.[0], operation.id).toEqual(restriction?.origin);
        checked.push(`${operation.id} sort ${sortKey.key}`);
      }
    }

    expect(checked).toContain("createTask CreateTask/effort");
    expect(checked).toContain("listTasks sort effort");
  });

  // ADR 0002 section 6: tree.schemas adds the version property that tree.nodes' concurrency names.
  test("tasks: the version property is the last of each body-versioned input, and only there", () => {
    const draft = draftFixture("tasks", "after-tree");
    const versionedInputs = new Set<string>();

    for (const operation of draft.operations) {
      const version = operation.concurrency?.version;
      const input = operation.input?.schema;
      const item = operation.responses?.find((response) => response.body?.kind === "ref")?.body;

      if (version?.in !== "body" || input?.kind !== "ref" || item?.kind !== "ref") continue;

      versionedInputs.add(input.schema);
      const versionProperty = propertiesOf(draft, input.schema).at(-1);
      const itemField = propertiesOf(draft, item.schema).find(
        (property) => property.name === operation.concurrency?.field,
      );

      expect(versionProperty, operation.id).toMatchObject({
        name: version.name,
        type: itemField?.type,
        derivedFrom: { derivation: "concurrency.version" },
      });
    }

    const schemasWithVersionProperty = Object.keys(draft.schemas).filter((id) =>
      propertiesOf(draft, id).some(
        (property) => property.derivedFrom?.derivation === "concurrency.version",
      ),
    );

    expect(schemasWithVersionProperty.sort()).toEqual([...versionedInputs].sort());
    expect(versionedInputs.size).toBeGreaterThan(0);
  });

  // access.identity writes rawBody on every declared input, access.rights only on a proof-only one.
  test.each(APIS)("%s: input.rawBody is written by the half the input calls for", (api) => {
    const declaredInputs = draftFixture(api, "after-tree")
      .operations.filter((operation) => operation.input !== undefined)
      .map((operation) => operation.id);
    const afterAccess = draftFixture(api, "after-access").operations;
    const proofOnlyInputs = afterAccess
      .filter(
        (operation) =>
          !declaredInputs.includes(operation.id) && operation.input?.proofs !== undefined,
      )
      .map((operation) => operation.id);
    const [identity, rights] = draftFixtureHalves(api, "access-delta");

    expect(rawBodyWriters(identity?.members).sort()).toEqual([...declaredInputs].sort());
    expect(rawBodyWriters(rights?.members).sort()).toEqual([...proofOnlyInputs].sort());
  });

  test.each(APIS)(
    "%s: the schema uses are written in the raw tree, and are every use tree.nodes and the access catalogues write",
    (api) => {
      const draft = draftFixture(api, "after-access");
      const { typeUses } = draftFixtureSchemaTables(api);

      for (const { pointer, use, at } of typeUses) {
        expect(valueAtPointer(rawApi(api).merged, pointer), pointer).toBeDefined();

        for (const position of at) {
          const written = valueAtPointer(draft, position);

          // A `SchemaRef` position holds the id of the schema the use refers to.
          if (typeof written === "string")
            expect(use, position).toEqual({ kind: "ref", schema: written });
          else expect(use, position).toEqual(written);
        }
      }

      const expectedPositions = [
        ...declaredRouteSchemaPositions(draftFixture(api, "after-tree")),
        ...accessCatalogueSchemaPositions(api),
      ];

      expect(typeUses.flatMap(({ at }) => at).sort()).toEqual(expectedPositions.sort());
    },
  );

  test.each(APIS)("%s: the fixture service answers each type use, in its direction only", (api) => {
    const service = draftFixtureSchemaService(api);

    for (const { pointer, direction, use } of draftFixtureSchemaTables(api).typeUses) {
      const otherDirection = direction === "input" ? "output" : "input";
      const answered = service.typeUse(pointer, direction);

      expect(answered, pointer).toEqual(use);
      expect(answered, pointer).not.toBe(service.typeUse(pointer, direction));
      expect(service.typeUse(pointer, otherDirection), pointer).toBeUndefined();
    }

    expect(service.typeUse("/surfaces/app/routes/missing", "input")).toBeUndefined();
  });

  // The real service answers a rule proof schema's query wire, the `wire` of a form or multipart proof. The
  // reference proof is read in a JSON body, so its InputProof carries no wire: the table holds what the real
  // service would answer, for a form proof.
  test.each(APIS)(
    "%s: the fixture service answers the query wire of every declared query field and rule proof schema",
    (api) => {
      const service = draftFixtureSchemaService(api);
      const { queryWires } = draftFixtureSchemaTables(api);
      const draft = draftFixture(api, "after-access");
      const proofSchemas = Object.values(draft.rules)
        .filter((rule) => rule.proof !== undefined)
        .map((rule) => `/rules/${rule.id}/proof/schema`);

      const declaredQueryFields = draft.operations.flatMap((operation) =>
        (operation.params?.query ?? []).flatMap((param) =>
          param.derivedFrom === undefined && param.origin !== undefined
            ? [{ pointer: param.origin.pointer, wire: param.wire }]
            : [],
        ),
      );

      // A form or multipart input would need its field rows too; the reference declares none.
      expect(draft.operations.filter((operation) => operation.input?.fields !== undefined)).toEqual(
        [],
      );

      expect(queryWires.map(({ pointer }) => pointer).sort()).toEqual(
        [...proofSchemas, ...declaredQueryFields.map(({ pointer }) => pointer)].sort(),
      );

      for (const { pointer, wire } of declaredQueryFields)
        expect(service.queryWire(pointer), pointer).toEqual(wire);

      for (const { pointer, wire } of queryWires) {
        expect(valueAtPointer(rawApi(api).merged, pointer), pointer).toBeDefined();
        const answered = service.queryWire(pointer);

        expect(answered, pointer).toEqual(wire);
        expect(answered, pointer).not.toBe(service.queryWire(pointer));
      }

      expect(service.queryWire("/surfaces/app/routes/missing")).toBeUndefined();

      const jsonProofs = draft.operations
        .filter((operation) => operation.input?.media === "application/json")
        .flatMap((operation) => operation.input?.proofs ?? []);

      for (const proof of jsonProofs) expect(proof.wire, proof.name).toBeUndefined();
    },
  );

  test("the fixture service finds the invalid example marker, wherever it sits", () => {
    const service = draftFixtureSchemaService("tasks");
    const [first] = draftFixtureSchemaTables("tasks").typeUses;

    if (first === undefined) throw new Error("tasks.schema-uses.json lists no use");

    expect(service.checkExample({ title: "ok" }, first.use)).toEqual([]);
    expect(
      service.checkExample({ items: [{ "a/b": DRAFT_FIXTURE_INVALID_EXAMPLE }] }, first.use),
    ).toEqual([{ pointer: "/items/0/a~1b", message: expect.any(String) }]);
  });

  test("the reference contract loads with no diagnostic", () => {
    expect(loaded.diagnostics).toEqual([]);
  });
});
