import { fileURLToPath } from "node:url";
import type { Origin } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { isDerivationId } from "../derivations/table.js";
import { diagnosticLocationKey } from "../diagnostics/print.js";
import { loadFsReader, loadWorkspace } from "../load/index.js";
import type { RawApi } from "../raw-tree.js";
import { createDraftIR } from "./draft.js";
import {
  type DraftFixtureApi,
  draftFixture,
  draftFixtureApply,
  draftFixtureHalves,
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

const REFERENCE = fileURLToPath(new URL("../../../../fixtures/reference", import.meta.url));
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
function applyGuarded(
  draft: ReturnType<typeof createDraftIR>,
  api: DraftFixtureApi,
  file: "after-tree" | "access-delta",
) {
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

// The elements of every `elements` list of the ownership table, in each operation of `draft`.
function elementsOf(draft: ReturnType<typeof createDraftIR>): { at: string; element: unknown }[] {
  const found: { at: string; element: unknown }[] = [];
  for (const [index, operation] of draft.operations.entries()) {
    const lists: [string, readonly unknown[] | undefined][] = [
      ["params/path", operation.params?.path],
      ["params/query", operation.params?.query],
      ["params/header", operation.params?.header],
      ["responses", operation.responses],
      ...(operation.responses ?? []).map((response, status): [string, readonly unknown[]] => [
        `responses/${status}/headers`,
        response.headers,
      ]),
    ];
    for (const [list, elements] of lists)
      for (const [position, element] of (elements ?? []).entries())
        found.push({ at: `/operations/${index}/${list}/${position}`, element });
  }
  return found;
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
      for (const { at, element } of elementsOf(draft)) {
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

  // ADR 0004 section 13 and LD-8: the origin is the first requirement that brings a body proof.
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

  test("the reference contract loads with no diagnostic", () => {
    expect(loaded.diagnostics).toEqual([]);
  });
});
