import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { derivationRowOf } from "../../../derivations/table.js";
import { type DraftFixtureApi, draftFixture } from "../../../pipeline/draft-fixture.js";
import { DraftAccessError, pipelineGuard } from "../../../pipeline/seam.js";
import { deriveWirePass } from "./pass.js";
import {
  deriveWireDerivedHeaders,
  deriveWireFixtureJson,
  deriveWireFixtureVariant,
  deriveWireLoadFixture,
  deriveWireLocated,
  deriveWireMembers,
  deriveWireOperation,
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

  test("a read outside the declared fields throws", () => {
    const guarded = pipelineGuard(draftFixture("tasks", "after-access"), {
      ...deriveWirePass,
      reads: deriveWirePass.reads.filter((field) => field !== "identities"),
    });

    try {
      expect(() => guarded.draft.identities).toThrow(DraftAccessError);
    } finally {
      guarded.dispose();
    }
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
        rule: "seampact/derive/derived-param-collision",
        pointer: "/surfaces/app/routes/notes",
        related: ["/surfaces/app/routes/notes/headers/Idempotency-Key", "/conventions/idempotency"],
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

    expect(diagnostics).toHaveLength(2);

    for (const diagnostic of diagnostics) {
      expect(diagnostic.rule).toMatch(/^seampact\/derive\/[a-z-]+$/);
      expect(diagnostic.message.length).toBeGreaterThan(0);
      expect(diagnostic.fix).toMatch(/\.$/);
      expect(diagnostic.origin.layer).not.toBe("core");
    }
  });
});
