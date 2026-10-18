import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { derivationRowOf } from "../../../derivations/table.js";
import { type DraftFixtureApi, draftFixture } from "../../../pipeline/draft-fixture.js";
import { DraftAccessError } from "../../../pipeline/seam.js";
import { treeNodesRelayedTasks } from "../../tree/nodes/test-support.js";
import { deriveWirePass } from "./pass.js";
import {
  deriveWireDerivedHeaders,
  deriveWireFixtureJson,
  deriveWireFixtureVariant,
  deriveWireLoadFixture,
  deriveWireLocated,
  deriveWireMembers,
  deriveWireOperation,
  deriveWireReferenceVariant,
  deriveWireReferenceWorkspace,
  deriveWireRunContract,
  deriveWireRunReference,
} from "./test-support.js";

const workspace = deriveWireReferenceWorkspace();

describe("derive.wire matches the derive delta", () => {
  test.each(["tasks", "tasksService"] as const)(
    "%s: the members of this half, guarded, on the after-access draft",
    (api) => {
      const run = deriveWireRunReference(workspace, api);

      expect(run.diagnostics).toEqual([]);
      expect(deriveWireMembers(run.draft)).toEqual(
        deriveWireFixtureJson("reference", `${api}.derive-wire.json`),
      );
    },
  );

  test("a read outside the declared reads throws", () => {
    const trimmed = {
      ...deriveWirePass,
      reads: deriveWirePass.reads.filter((field) => field !== "identities"),
    };

    expect(() => deriveWireRunReference(workspace, "tasks", trimmed)).toThrow(DraftAccessError);
  });

  test("a write outside the declared writes throws", () => {
    const trimmed = {
      ...deriveWirePass,
      writes: deriveWirePass.writes.filter((field) => field !== "operations[].params.header"),
    };

    expect(() => deriveWireRunReference(workspace, "tasks", trimmed)).toThrow(DraftAccessError);
  });
});

describe("derive.wire elements carry derivedFrom", () => {
  // Every element this half adds follows the elements of the after-access draft.
  const addedRecords = (api: DraftFixtureApi): (IrWriter.DerivedFrom | undefined)[] => {
    const before = draftFixture(api, "after-access");
    const after = deriveWireRunReference(workspace, api).draft;

    return after.operations.flatMap((operation, index) => {
      const earlier = before.operations[index];
      const added = <T>(now: readonly T[] | undefined, then: readonly T[] | undefined): T[] =>
        (now ?? []).slice((then ?? []).length);
      const params = [
        ...added(operation.params?.header, earlier?.params?.header),
        ...added(operation.params?.query, earlier?.params?.query),
      ];
      const headers = (operation.responses ?? []).flatMap((response, position) =>
        added(response.headers, earlier?.responses?.[position]?.headers),
      );
      const idempotency = operation.idempotency?.kind === "derived" ? [operation.idempotency] : [];

      return [...params, ...headers, ...idempotency].map((element) => element.derivedFrom);
    });
  };

  test.each(["tasks", "tasksService"] as const)(
    "%s: each added element names a derive.wire derivation and its origins",
    (api) => {
      const records = addedRecords(api);

      expect(records.length).toBeGreaterThan(0);

      for (const record of records) {
        expect(derivationRowOf(record?.derivation ?? "")?.wire).toBe("derive.wire");
        expect(record?.from.length).toBeGreaterThan(0);
      }
    },
  );
});

describe("derive.wire elements of the wire fixture carry derivedFrom", () => {
  test("every derivation of the half writes its record with its origins", () => {
    const run = deriveWireRunContract(deriveWireLoadFixture("wire"));
    const records = run.draft.operations.flatMap((operation) => {
      const unknownKeys =
        operation.input?.schema.kind === "ref" ? operation.input.schema.unknownKeys : undefined;

      return [
        ...(operation.params?.header ?? []),
        ...(operation.params?.query ?? []),
        ...(operation.responses ?? []).flatMap((response) => response.headers),
        ...(unknownKeys === undefined ? [] : [unknownKeys]),
        ...(operation.idempotency?.kind === "derived" ? [operation.idempotency] : []),
      ].flatMap((element) => (element.derivedFrom === undefined ? [] : [element.derivedFrom]));
    });

    for (const record of records) expect(record.from.length).toBeGreaterThan(0);

    expect(new Set(records.map((record) => record.derivation))).toEqual(
      new Set([
        "identity.authenticate",
        "csrf.cookieWrite",
        "idempotency.write",
        "identity.header",
        "identity.versionToken",
        "union.headerTag",
        "input.unknownKeys",
      ]),
    );
  });
});

describe("derived parameter order", () => {
  test("derived parameters follow the derivation table, then source order", () => {
    const run = deriveWireRunContract(deriveWireLoadFixture("wire"));

    expect(deriveWireDerivedHeaders(run, "jobs")).toEqual([
      ["Authorization", false, "identity.authenticate"],
      ["Idempotency-Key", true, "idempotency.write"],
      ["X-Deadline", true, "identity.header"],
      ["traceparent", false, "identity.header"],
    ]);
    expect(deriveWireDerivedHeaders(run, "notes")).toEqual([
      ["X-Csrf-Token", true, "csrf.cookieWrite"],
      ["Idempotency-Key", true, "idempotency.write"],
      ["If-Rights-Version", false, "identity.versionToken"],
    ]);
  });
});

describe("unknown keys", () => {
  const run = deriveWireRunContract(deriveWireLoadFixture("wire"));
  const unknownKeysOf = (id: string) => {
    const schema = deriveWireOperation(run, id).input?.schema;

    return schema?.kind === "ref" ? schema.unknownKeys : undefined;
  };

  test("conventions.input.unknownKeys reaches every body input use that sets none", () => {
    expect(unknownKeysOf("notes")).toEqual({
      policy: "ignore",
      reason: "Older clients still send fields the api dropped.",
      derivedFrom: {
        derivation: "input.unknownKeys",
        from: [{ layer: "api", pointer: "/conventions/input/unknownKeys" }],
      },
    });
    expect(unknownKeysOf("github")?.policy).toBe("ignore");
  });

  test("a policy on the use wins", () => {
    expect(unknownKeysOf("bigNotes")).toMatchObject({ policy: "refuse" });
    expect(unknownKeysOf("bigNotes")?.derivedFrom).toBeUndefined();
  });

  test("keep is written as keep, and the default refuse writes nothing", () => {
    const keep = deriveWireRunContract(
      deriveWireFixtureVariant("wire", [['{ ignore: "Older clients', '{ keep: "Older clients']]),
    );
    const reference = deriveWireRunReference(workspace, "tasks");
    const referenceSchema = deriveWireOperation(reference, "createTask").input?.schema;

    expect(deriveWireOperation(keep, "notes").input?.schema).toMatchObject({
      unknownKeys: { policy: "keep" },
    });
    expect(
      referenceSchema?.kind === "ref" ? referenceSchema.unknownKeys : "not a ref",
    ).toBeUndefined();
  });
});

describe("relay routes derive their own wire", () => {
  test("the relay route takes its own credential and identity headers, none of the public operation's", () => {
    const service = deriveWireRunReference(workspace, "tasksService");
    const publicApi = deriveWireRunReference(workspace, "tasks");

    expect(deriveWireOperation(service, "getTask").relays).toBeDefined();
    expect(deriveWireDerivedHeaders(service, "getTask")).toEqual([
      ["Authorization", true, "identity.authenticate"],
      ["X-Deadline", true, "identity.header"],
      ["traceparent", false, "identity.header"],
    ]);
    expect(deriveWireDerivedHeaders(publicApi, "getTask")).toEqual([
      ["Authorization", false, "identity.authenticate"],
    ]);

    const from = service.draft.operations
      .flatMap((operation) => operation.params?.header ?? [])
      .flatMap((param) => param.derivedFrom?.from ?? []);

    expect(from.map((origin) => origin.pointer)).not.toContain("/surfaces/app/identity");
  });
});

describe("relay routes carry the public operation's method", () => {
  test("a relay route derives its idempotency key and credentials like any route, and nothing is refused", () => {
    const run = deriveWireRunContract(
      deriveWireReferenceVariant("tasks-service/api.yaml", [
        [
          "      getTask: { relays: tasks.getTask }\n",
          "      getTask: { relays: tasks.getTask }\n      assignTask: { relays: tasks.assignTask }\n",
        ],
      ]),
      "tasksService",
      { relayed: treeNodesRelayedTasks() },
    );

    expect(run.diagnostics).toEqual([]);
    expect(deriveWireOperation(run, "getTask")).toMatchObject({ method: "get", safe: true });
    expect(deriveWireOperation(run, "getTask").idempotency).toBeUndefined();
    expect(deriveWireDerivedHeaders(run, "getTask")).toEqual([
      ["Authorization", true, "identity.authenticate"],
      ["X-Deadline", true, "identity.header"],
      ["traceparent", false, "identity.header"],
    ]);
    expect(deriveWireOperation(run, "assignTask")).toMatchObject({ method: "post" });
    expect(deriveWireOperation(run, "assignTask").idempotency).toMatchObject({
      kind: "derived",
      header: "Idempotency-Key",
    });
    expect(deriveWireDerivedHeaders(run, "assignTask")).toContainEqual([
      "Idempotency-Key",
      true,
      "idempotency.write",
    ]);
  });
});

describe("derive.wire diagnostics are located", () => {
  test("a derived header colliding with a declared one is refused at the route, naming both", () => {
    const run = deriveWireRunContract(
      deriveWireFixtureVariant("wire", [
        [
          "      notes:\n        input: Note\n",
          "      notes:\n        headers: { Idempotency-Key: { type: string } }\n        input: Note\n",
        ],
      ]),
    );

    expect(run.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/derived-name-collision",
        pointer: "/surfaces/app/routes/notes",
        related: ["/surfaces/app/routes/notes/headers/Idempotency-Key", "/conventions/idempotency"],
      },
    ]);
  });

  test("a derivation taking another derivation's name is refused once at its origin, naming the first route", () => {
    const run = deriveWireRunContract(
      deriveWireFixtureVariant("wire", [["header: Idempotency-Key", "header: Authorization"]]),
    );

    // comments, comment and jobs all take Authorization from a credential before the key.
    expect(run.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/derived-name-collision",
        pointer: "/conventions/idempotency",
        related: ["/surfaces/mixed/routes/comments", "/surfaces/mixed/identity", "/schemes/bearer"],
      },
    ]);
  });

  test("two header declarations of one identity on one wire name with a different requirement are refused", () => {
    const run = deriveWireRunContract(
      deriveWireFixtureVariant("wire", [
        [
          "  trace: { name: traceparent, in: request, semantic: traceContext }\n",
          "  trace: { name: traceparent, in: request, semantic: traceContext }\n  trace2: { name: TraceParent, in: request, semantic: traceContext }\n",
        ],
        [
          "      trace: { for: writes }\n",
          "      trace: { for: writes }\n      trace2: { for: writes, required: true }\n",
        ],
      ]),
    );

    expect(run.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/derived-name-collision",
        pointer: "/headers/trace2",
        related: [
          "/surfaces/robots/routes/jobs",
          "/identities/robot/headers/trace",
          "/headers/trace",
          "/identities/robot/headers/trace2",
        ],
      },
    ]);
  });

  test("every diagnostic has a derive rule, a message, a fix and an authored origin", () => {
    const runs = [
      deriveWireRunContract(deriveWireFixtureVariant("wire", [["lifetime: 1h, ", ""]])),
      deriveWireRunContract(
        deriveWireFixtureVariant("wire", [
          [
            "      board:\n        method: get\n",
            '      board:\n        method: get\n        idempotency: { exempt: "Reads repeat." }\n',
          ],
        ]),
      ),
    ];
    const diagnostics = runs.flatMap((run) => run.diagnostics);

    expect(diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/idempotency-convention",
        pointer: "/conventions/idempotency",
        related: [],
      },
      {
        rule: "seampact/derive/idempotency-exempt-unused",
        pointer: "/surfaces/app/routes/board/idempotency",
        related: [],
      },
    ]);

    for (const diagnostic of diagnostics) {
      expect(diagnostic.rule).toMatch(/^seampact\/derive\/[a-z-]+$/);
      expect(diagnostic.message.length).toBeGreaterThan(0);
      expect(diagnostic.fix).toMatch(/\.$/);
      expect(diagnostic.origin.layer).not.toBe("core");
    }
  });
});
