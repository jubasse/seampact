import type { ContractIR } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { DIFF_CODES } from "./diff-codes.js";
import { diffContractSets, diffContracts } from "./diff-contracts.js";
import { formatDiffReport } from "./report/format.js";
import {
  changesOf,
  diffOk,
  editedIr,
  goldenIr,
  goldenIrFiles,
  objectSchemaOf,
  operationOf,
  TODAY,
} from "./test-support.js";

// The diff end to end on golden IR pairs: refusals, positions, the gate, the deprecation report and the report form.

const ORIGIN = { layer: "api" as const, pointer: "/test" };

function removeTaskTitle(ir: ContractIR): void {
  objectSchemaOf(ir, "Task").properties.splice(1, 1);
}

function removeHealth(ir: ContractIR): void {
  ir.operations = ir.operations.filter((operation) => operation.id !== "health");
}

function setPolicy(policy: string): (ir: ContractIR) => void {
  return (ir) => {
    ir.api.compat.policy = policy;
  };
}

// A required input field made optional: breaks servers only.
function relaxCreateTitle(ir: ContractIR): void {
  const title = objectSchemaOf(ir, "CreateTask").properties.find(
    (property) => property.name === "title",
  );

  if (title !== undefined) title.optional = true;
}

function deprecateHealth(sunset: string): (ir: ContractIR) => void {
  return (ir) => {
    operationOf(ir, "health").deprecated = {
      since: "2026-01-01",
      sunset,
      successor: { kind: "httpOperation", api: "tasks", id: "getChannel" },
      successorRel: "successor-version",
      origin: ORIGIN,
    };
  };
}

describe("whole-diff refusals", () => {
  test("refuses two irVersion values naming both", () => {
    const after = editedIr((ir) => {
      ir.irVersion = 2;
    });
    const result = diffContracts(goldenIr(), after, { today: TODAY });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.refusals).toMatchObject([
      { code: DIFF_CODES.irVersionDiffers, before: 1, after: 2 },
    ]);
  });

  test("refuses two irRevision values, an api name and an api version change", () => {
    const after = editedIr((ir) => {
      ir.irRevision += 1;
      ir.api.id = "other";
    });
    const result = diffContracts(goldenIr(), after, { today: TODAY });
    const codes = result.ok ? [] : result.refusals.map((refusal) => refusal.code);

    expect(codes).toEqual([DIFF_CODES.irRevisionDiffers, DIFF_CODES.apiNameDiffers]);

    const versioned = editedIr((ir) => {
      ir.api.version = { kind: "path", number: 2 };
    });
    const versionResult = diffContracts(goldenIr(), versioned, { today: TODAY });

    expect(versionResult.ok ? [] : versionResult.refusals).toMatchObject([
      { code: DIFF_CODES.apiVersionDiffers, before: "v1", after: "v2" },
    ]);
  });

  test("refuses an unknown type use kind naming the member", () => {
    const after = editedIr((ir) => {
      const title = objectSchemaOf(ir, "Task").properties[1];

      if (title !== undefined) title.type = { kind: "tuple" };
    });
    const result = diffContracts(goldenIr(), after, { today: TODAY });

    expect(result.ok ? [] : result.refusals).toMatchObject([
      {
        code: DIFF_CODES.unknownValue,
        member: "/schemas/Task/properties/1/type/kind",
        operations: expect.arrayContaining(["getTask"]),
      },
    ]);
  });

  test("refuses an unknown maturity level the gate acts on", () => {
    const after = editedIr((ir) => {
      operationOf(ir, "health").maturity.level = "frozen";
    });
    const result = diffContracts(goldenIr(), after, { today: TODAY });

    expect(result.ok ? [] : result.refusals).toMatchObject([
      { code: DIFF_CODES.unknownValue, operations: ["health"] },
    ]);
  });

  test("throws on a today that is no calendar date", () => {
    expect(() => diffContracts(goldenIr(), goldenIr(), { today: "2026-02-30" })).toThrow(
      /YYYY-MM-DD/,
    );
  });
});

describe("positions", () => {
  test("a schema used in input and output gets both classifications", () => {
    const useCreateTaskInOutput = (ir: ContractIR) => {
      const [response] = operationOf(ir, "getDraft").responses;

      if (response !== undefined) response.body = { kind: "ref", schema: "CreateTask" };
    };

    const base = editedIr(useCreateTaskInOutput);
    const after = editedIr((ir) => {
      const title = objectSchemaOf(ir, "CreateTask").properties[0];

      if (title?.type.kind === "scalar" && "refinements" in title.type)
        title.type.refinements.maxLength = 100;
    }, base);
    const tightened = changesOf(base, after).filter((change) => change.kind === "refinement");

    expect(tightened).toMatchObject([
      { position: "input", operations: ["createTask"], breaks: ["clients"] },
      { position: "output", operations: ["getDraft"], breaks: ["servers"] },
    ]);
  });

  test("reordering properties is info on the wire", () => {
    const after = editedIr((ir) => objectSchemaOf(ir, "Task").properties.reverse());
    const changes = changesOf(goldenIr(), after);

    expect(changes.map((change) => [change.kind, change.classification])).toEqual([
      ["order", "informative"],
    ]);
  });

  test("a pack upgrade carries its pack as cause", () => {
    const base = editedIr((ir) => {
      ir.packs = [{ name: "audit", version: "1.0.0" }];
    });
    const after = editedIr((ir) => {
      ir.packs = [{ name: "audit", version: "1.1.0" }];
      objectSchemaOf(ir, "Task").properties.push({
        name: "auditedAt",
        type: { kind: "scalar", type: "string", format: "date-time", refinements: {} },
        optional: true,
        nullable: false,
        sensitive: false,
        deprecated: false,
        docs: {},
        extensions: {},
        origin: { layer: "pack:audit", pointer: "/schemas/Task/properties/auditedAt" },
      });
    }, base);
    const added = changesOf(base, after).find((change) => change.kind === "property.added");

    expect(added).toMatchObject({ case: "optional", position: "output", cause: { pack: "audit" } });
  });
});

describe("the gate", () => {
  test("additive-only fails a removed response field naming clients and the operation", () => {
    const result = diffOk(goldenIr(), editedIr(removeTaskTitle));

    expect(result.gate.passed).toBe(false);
    expect(result.gate.failures).toMatchObject([
      {
        code: DIFF_CODES.policyBreaking,
        kind: "property.removed",
        breaks: ["clients"],
        operations: expect.arrayContaining(["getTask"]),
        pointer: "/schemas/Task/properties/1",
      },
    ]);
  });

  test("none reports and passes", () => {
    const base = editedIr(setPolicy("none"));
    const result = diffOk(base, editedIr(removeTaskTitle, base));

    expect(result.changes.map((change) => change.kind)).toEqual(["property.removed"]);
    expect(result.gate).toEqual({ passed: true, failures: [] });
  });

  test("stable is refused on a removed operation", () => {
    const base = editedIr((ir) => {
      operationOf(ir, "health").maturity = { level: "stable", source: "stated", origin: ORIGIN };
    });
    const result = diffOk(base, editedIr(removeHealth, base));

    expect(result.gate.failures.map((failure) => failure.code)).toEqual([
      DIFF_CODES.policyBreaking,
      DIFF_CODES.maturityStable,
    ]);
    expect(result.gate.failures[1]).toMatchObject({
      maturity: { operation: "health", level: "stable", source: "stated" },
    });
  });

  test("lowering a stable operation to escape the refusal fails too", () => {
    const base = editedIr((ir) => {
      operationOf(ir, "health").maturity = { level: "stable", source: "stated", origin: ORIGIN };
    });
    const after = editedIr((ir) => {
      operationOf(ir, "health").maturity.level = "provisional";
    }, base);
    const result = diffOk(base, after);

    expect(result.gate.failures.map((failure) => [failure.code, failure.kind])).toEqual([
      [DIFF_CODES.policyBreaking, "maturity"],
      [DIFF_CODES.maturityStable, "maturity"],
    ]);
  });

  test("provisional additive-only passes an additive diff and fails a breaking one", () => {
    const additive = editedIr((ir) => {
      const copy = structuredClone(operationOf(ir, "health"));

      ir.operations.push({ ...copy, id: "healthAgain", path: `${copy.path}/again` });
    });

    expect(diffOk(goldenIr(), additive).gate.passed).toBe(true);
    expect(diffOk(goldenIr(), editedIr(removeHealth)).gate.passed).toBe(false);
  });

  test("the stricter policy applies when after relaxes it", () => {
    const after = editedIr((ir) => {
      setPolicy("none")(ir);
      removeTaskTitle(ir);
    });
    const result = diffOk(goldenIr(), after);

    expect(result.policy).toEqual({
      before: "additive-only",
      after: "none",
      applied: "additive-only",
    });
    expect(result.gate.passed).toBe(false);
  });

  test("the clients gate reports a change breaking servers only and passes", () => {
    const result = diffOk(goldenIr(), editedIr(relaxCreateTitle));

    expect(result.settings.gate).toBe("clients");
    expect(result.changes).toMatchObject([{ kind: "property.required", breaks: ["servers"] }]);
    expect(result.gate.passed).toBe(true);
  });

  test("the both gate fails a change breaking servers only", () => {
    const result = diffOk(goldenIr(), editedIr(relaxCreateTitle), { gate: "both" });

    expect(result.gate.failures).toMatchObject([
      { code: DIFF_CODES.policyBreaking, breaks: ["servers"] },
    ]);
  });

  test("an operation experimental in the baseline is exempt unless the exemption is off", () => {
    const base = editedIr((ir) => {
      operationOf(ir, "health").maturity = {
        level: "experimental",
        source: "stated",
        origin: ORIGIN,
      };
    });
    const after = editedIr(removeHealth, base);
    const exempted = diffOk(base, after);

    expect(exempted.gate.passed).toBe(true);
    expect(exempted.changes).toMatchObject([
      { kind: "operation.removed", exemption: "experimental" },
    ]);
    expect(diffOk(base, after, { exempt: [] }).gate.passed).toBe(false);
  });

  test("removing an operation past its sunset is exempt as sunsetPassed", () => {
    const base = editedIr(deprecateHealth("2026-10-20"));
    const result = diffOk(base, editedIr(removeHealth, base));

    expect(result.gate.passed).toBe(true);
    expect(result.changes).toMatchObject([
      { kind: "operation.removed", breaks: ["clients"], exemption: "sunsetPassed" },
    ]);
    expect(
      diffOk(base, editedIr(removeHealth, base), { exempt: ["experimental"] }).gate.passed,
    ).toBe(false);
  });
});

describe("the deprecation report", () => {
  test("reads an absent deprecated flag as false", () => {
    const result = diffOk(
      goldenIr(),
      editedIr((ir) => {
        objectSchemaOf(ir, "Task").deprecated = false;
      }),
    );

    expect(result.changes).toEqual([]);
    expect(result.deprecations).toEqual([]);
  });

  test("reports a new deprecation with days to sunset", () => {
    const result = diffOk(goldenIr(), editedIr(deprecateHealth("2026-11-19")));

    expect(result.deprecations).toEqual([
      {
        subject: "operation",
        operation: "health",
        pointer: expect.stringMatching(/^\/operations\/\d+\/deprecated$/),
        status: "new",
        since: "2026-01-01",
        sunset: "2026-11-19",
        successor: "getChannel",
        daysToSunset: 30,
        pastSunset: false,
      },
    ]);
  });

  test("reports a removed operation with its sunset state", () => {
    const passed = editedIr(deprecateHealth("2026-10-01"));
    const pending = editedIr(deprecateHealth("2027-01-01"));

    expect(diffOk(passed, editedIr(removeHealth, passed)).deprecations).toMatchObject([
      { operation: "health", status: "sunsetPassed", pastSunset: true, daysToSunset: -19 },
    ]);
    expect(diffOk(pending, editedIr(removeHealth, pending)).deprecations).toMatchObject([
      { operation: "health", status: "removed", pastSunset: false },
    ]);
  });

  test("reports a property whose deprecated flag changed", () => {
    const after = editedIr((ir) => {
      const effort = objectSchemaOf(ir, "Task").properties[3];

      if (effort !== undefined) effort.deprecated = true;
    });

    expect(diffOk(goldenIr(), after).deprecations).toEqual([
      {
        subject: "property",
        pointer: "/schemas/Task/properties/3",
        schema: "Task",
        property: "effort",
        status: "deprecated",
      },
    ]);
  });
});

describe("the result", () => {
  test.each(goldenIrFiles())("an IR diffed against itself gives no change: %s", (file) => {
    const result = diffOk(goldenIr(file), goldenIr(file));

    expect(result.changes).toEqual([]);
    expect(result.gate.passed).toBe(true);
  });

  test("the report order is stable", () => {
    const after = editedIr((ir) => {
      removeTaskTitle(ir);
      removeHealth(ir);
      operationOf(ir, "getTask").tags.push("reads");
    });
    const reordered = editedIr((ir) => {
      ir.operations.reverse();
      ir.schemas = Object.fromEntries(Object.entries(ir.schemas).reverse());
    }, after);
    const first = JSON.stringify(diffOk(goldenIr(), after).changes);

    expect(JSON.stringify(diffOk(goldenIr(), after).changes)).toBe(first);
    expect(diffOk(goldenIr(), reordered).changes.map((change) => change.kind)).toEqual(
      diffOk(goldenIr(), after).changes.map((change) => change.kind),
    );
  });

  test("the text report prints changes, then failures in diagnostic form", () => {
    const text = formatDiffReport(diffOk(goldenIr(), editedIr(removeTaskTitle)));

    expect(text).toContain(
      "breaking clients archiveTask,assignTask,createTask,getTask,getTasksBatch,listTasks,searchTasks,updateTask output /schemas/Task/properties/1: property.removed required (title)",
    );
    expect(text).toMatch(/^diff\.policy\.breaking: .+ Fix: .+$/m);
    expect(text.trimEnd().endsWith("gate failed: 1 failure(s)")).toBe(true);
  });

  test("a refused diff prints its refusals in diagnostic form", () => {
    const after = editedIr((ir) => {
      ir.irVersion = 2;
    });

    expect(formatDiffReport(diffContracts(goldenIr(), after, { today: TODAY }))).toMatch(
      /^diff\.irVersion\.differs: .+ Fix: .+\n$/,
    );
  });

  test("an api only in one set is diffed against no operations", () => {
    const tasks = goldenIr();
    const service = goldenIr("reference/tasksService.ir.json");
    const results = diffContractSets(
      new Map([["tasks", tasks]]),
      new Map([["tasksService", service]]),
      { today: TODAY },
    );
    const kinds = (name: string) => {
      const result = results.get(name);

      return result?.ok ? [...new Set(result.changes.map((change) => change.kind))] : [];
    };

    expect([...results.keys()]).toEqual(["tasks", "tasksService"]);
    expect(kinds("tasks")).toEqual(["operation.removed"]);
    expect(kinds("tasksService")).toEqual(["operation.added"]);
  });
});
