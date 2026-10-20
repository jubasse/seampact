import type { ContractIR, Property, ScalarTypeUse, UnionSchema } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { DiffPosition } from "../result.js";
import {
  changesOf,
  editedIr,
  goldenIr,
  knownSchemaOf,
  objectSchemaOf,
  operationOf,
} from "../test-support.js";
import type { DiffKind } from "./rows.js";

// One case per row, case and position of the classification table (CHK-175, CHK-176), each a golden IR pair:
// `CreateTask` is reached from the input of createTask, `Task` from the output of getTask and the other task
// operations, `TaskState` from the input of searchTasks and from the output through `Task`.

type Edit = (ir: ContractIR) => void;

type Expected = "C" | "S" | "CS" | "-" | "info";

interface RowCase {
  kind: DiffKind;
  case: string;
  position: DiffPosition;
  expected: Expected;
  note?: string;
  /** Picks the change whose pointer holds this fragment, when the same row is also reported elsewhere. */
  pointerFragment?: string;
  base?: Edit;
  after: Edit;
}

const EXPECTED_OUTCOMES: Record<Expected, { breaks: string[]; classification: string }> = {
  C: { breaks: ["clients"], classification: "breaking" },
  S: { breaks: ["servers"], classification: "breaking" },
  CS: { breaks: ["clients", "servers"], classification: "breaking" },
  "-": { breaks: [], classification: "additive" },
  info: { breaks: [], classification: "informative" },
};

const ORIGIN = { layer: "api" as const, pointer: "/test" };

function taskSchema(ir: ContractIR) {
  return objectSchemaOf(ir, "Task");
}

function createSchema(ir: ContractIR) {
  return objectSchemaOf(ir, "CreateTask");
}

function propertyOf(ir: ContractIR, schema: string, name: string): Property {
  const property = objectSchemaOf(ir, schema).properties.find(
    (candidate) => candidate.name === name,
  );

  if (property === undefined) throw new Error(`no property ${schema}.${name} in the test IR`);

  return property;
}

function scalarOf(ir: ContractIR, schema: string, name: string): ScalarTypeUse {
  const type = propertyOf(ir, schema, name).type;

  if (type.kind !== "scalar" || !("refinements" in type))
    throw new Error(`${schema}.${name} is no scalar`);

  return type;
}

function newProperty(name: string, optional: boolean): Property {
  return {
    name,
    type: { kind: "scalar", type: "string", refinements: {} },
    optional,
    nullable: false,
    sensitive: false,
    deprecated: false,
    docs: {},
    extensions: {},
    origin: ORIGIN,
  };
}

function removeProperty(ir: ContractIR, schema: string, name: string): void {
  const properties = objectSchemaOf(ir, schema).properties;

  properties.splice(
    properties.findIndex((property) => property.name === name),
    1,
  );
}

// A union reached from the input of createTask and the output of the task operations.
function addShapeUnion(ir: ContractIR): void {
  const shape: UnionSchema = {
    kind: "union",
    tag: { in: "body", property: "type" },
    variants: [
      { tag: "draft", schema: "Draft" },
      { tag: "channel", schema: "Channel" },
    ],
    id: "Shape",
    name: { segments: ["shape"], role: "schema" },
    directions: ["input", "output"],
    examples: [],
    docs: {},
    extensions: {},
    origin: ORIGIN,
  };

  ir.schemas.Shape = shape;

  for (const schema of [createSchema(ir), taskSchema(ir)]) {
    schema.properties.push({
      ...newProperty("shape", true),
      type: { kind: "ref", schema: "Shape" },
    });
  }
}

function shapeUnion(ir: ContractIR): UnionSchema {
  const shape = knownSchemaOf(ir, "Shape");

  if (shape.kind !== "union") throw new Error("no Shape union in the test IR");

  return shape;
}

function deprecate(ir: ContractIR, sunset: string, successor?: string): void {
  operationOf(ir, "getTask").deprecated = {
    since: "2026-01-01",
    sunset,
    ...(successor === undefined
      ? {}
      : {
          successor: { kind: "httpOperation", api: "tasks", id: successor },
          successorRel: "successor-version",
        }),
    origin: ORIGIN,
  };
}

const ROW_CASES: RowCase[] = [
  {
    kind: "operation.added",
    case: "added",
    position: "none",
    expected: "-",
    after: (ir) => {
      const copy = structuredClone(operationOf(ir, "health"));

      ir.operations.push({ ...copy, id: "healthAgain", path: `${copy.path}/again` });
    },
  },
  {
    kind: "operation.removed",
    case: "removed",
    position: "none",
    expected: "C",
    after: (ir) => {
      ir.operations = ir.operations.filter((operation) => operation.id !== "health");
    },
  },
  ...(["method", "path", "surface"] as const).map(
    (member): RowCase => ({
      kind: "operation.route",
      case: member,
      position: "none",
      expected: "CS",
      after: (ir) => {
        const operation = operationOf(ir, "getTask");

        operation[member] =
          member === "method" ? "put" : member === "path" ? `${operation.path}/moved` : "hooks";
      },
    }),
  ),
  {
    kind: "operation.route",
    case: "surfacePrefix",
    position: "none",
    expected: "CS",
    after: (ir) => {
      const surface = ir.api.surfaces.app;

      if (surface !== undefined) surface.prefix = "/v1/app";
    },
  },
  {
    kind: "operation.route",
    case: "pathVersion",
    position: "none",
    expected: "CS",
    after: (ir) => {
      ir.api.pathVersion.value = "none";
    },
  },
  {
    kind: "operation.format",
    case: "changed",
    position: "none",
    expected: "CS",
    after: (ir) => {
      operationOf(ir, "getTask").format = "envelope";
    },
  },
  ...(
    [
      ["optional", "input", "-"],
      ["required", "input", "C"],
      ["optional", "output", "-"],
      ["required", "output", "S"],
    ] as const
  ).map(
    ([propertyCase, position, expected]): RowCase => ({
      kind: "property.added",
      case: propertyCase,
      position,
      expected,
      after: (ir) =>
        (position === "input" ? createSchema(ir) : taskSchema(ir)).properties.push(
          newProperty("label", propertyCase === "optional"),
        ),
    }),
  ),
  {
    kind: "property.removed",
    case: "required",
    position: "input",
    expected: "CS",
    after: (ir) => removeProperty(ir, "CreateTask", "title"),
  },
  {
    kind: "property.removed",
    case: "optional",
    position: "input",
    expected: "C",
    note: " when after refuses unknown keys",
    after: (ir) => removeProperty(ir, "CreateTask", "effort"),
  },
  {
    kind: "property.removed",
    case: "optional",
    position: "input",
    expected: "-",
    note: " when after ignores unknown keys",
    base: (ir) => {
      const input = operationOf(ir, "createTask").input;

      if (input?.schema.kind === "ref" && "schema" in input.schema) {
        input.schema.unknownKeys = { policy: "ignore", reason: "Older clients send extra keys." };
      }
    },
    after: (ir) => removeProperty(ir, "CreateTask", "effort"),
  },
  {
    kind: "property.removed",
    case: "required",
    position: "output",
    expected: "C",
    after: (ir) => removeProperty(ir, "Task", "title"),
  },
  {
    kind: "property.removed",
    case: "optional",
    position: "output",
    expected: "-",
    after: (ir) => removeProperty(ir, "Task", "effort"),
  },
  ...(
    [
      ["optionalToRequired", "input", "C", "CreateTask", "effort"],
      ["requiredToOptional", "input", "S", "CreateTask", "title"],
      ["optionalToRequired", "output", "S", "Task", "effort"],
      ["requiredToOptional", "output", "C", "Task", "title"],
    ] as const
  ).map(
    ([requiredCase, position, expected, schema, name]): RowCase => ({
      kind: "property.required",
      case: requiredCase,
      position,
      expected,
      after: (ir) => {
        const property = propertyOf(ir, schema, name);

        property.optional = !property.optional;
      },
    }),
  ),
  ...(
    [
      ["added", "input", "S", "CreateTask"],
      ["removed", "input", "C", "CreateTask"],
      ["added", "output", "C", "Task"],
      ["removed", "output", "S", "Task"],
    ] as const
  ).map(
    ([nullableCase, position, expected, schema]): RowCase => ({
      kind: "nullable",
      case: nullableCase,
      position,
      expected,
      ...(nullableCase === "removed"
        ? {
            base: (ir) => {
              propertyOf(ir, schema, "title").nullable = true;
            },
          }
        : {}),
      after: (ir) => {
        propertyOf(ir, schema, "title").nullable = nullableCase === "added";
      },
    }),
  ),
  ...(["input", "output"] as const).flatMap((position): RowCase[] => {
    const schema = position === "input" ? "CreateTask" : "Task";

    return [
      {
        kind: "type.changed",
        case: "kind",
        position,
        expected: "CS",
        after: (ir) => {
          propertyOf(ir, schema, "title").type = {
            kind: "opaque",
            reason: "Any title.",
            origin: ORIGIN,
          };
        },
      },
      {
        kind: "type.changed",
        case: "scalarType",
        position,
        expected: "CS",
        after: (ir) => {
          scalarOf(ir, schema, "title").type = "integer";
        },
      },
      {
        kind: "type.changed",
        case: "format",
        position,
        expected: "CS",
        after: (ir) => {
          scalarOf(ir, schema, "title").format = "email";
        },
      },
      {
        kind: "refinement",
        case: "tightened",
        position,
        expected: position === "input" ? "C" : "S",
        after: (ir) => {
          scalarOf(ir, schema, "title").refinements.maxLength = 100;
        },
      },
      {
        kind: "refinement",
        case: "loosened",
        position,
        expected: position === "input" ? "S" : "C",
        after: (ir) => {
          scalarOf(ir, schema, "title").refinements.minLength = 0;
        },
      },
      {
        kind: "refinement",
        case: "changed",
        position,
        expected: "CS",
        base: (ir) => {
          scalarOf(ir, schema, "effort").refinements.multipleOf = "0.2";
        },
        after: (ir) => {
          scalarOf(ir, schema, "effort").refinements.multipleOf = "0.3";
        },
      },
      {
        kind: "pattern.changed",
        case: "changed",
        position,
        expected: "CS",
        base: (ir) => {
          scalarOf(ir, schema, "title").refinements.pattern = { source: "^a", normalized: "^a" };
        },
        after: (ir) => {
          scalarOf(ir, schema, "title").refinements.pattern = { source: "^b", normalized: "^b" };
        },
      },
      {
        kind: "default.changed",
        case: "added",
        position,
        expected: position === "input" ? "C" : "info",
        after: (ir) => {
          propertyOf(ir, schema, "effort").default = 1;
        },
      },
      {
        kind: "union.variant",
        case: "added",
        position,
        expected: position === "input" ? "S" : "C",
        base: addShapeUnion,
        after: (ir) => shapeUnion(ir).variants.push({ tag: "preferences", schema: "Preferences" }),
      },
      {
        kind: "union.variant",
        case: "removed",
        position,
        expected: position === "input" ? "C" : "S",
        base: addShapeUnion,
        after: (ir) => shapeUnion(ir).variants.pop(),
      },
      {
        kind: "union.tag",
        case: "changed",
        position,
        expected: "CS",
        base: addShapeUnion,
        after: (ir) => {
          shapeUnion(ir).tag = { in: "body", property: "kind" };
        },
      },
      {
        kind: "enum.value",
        case: "added",
        position,
        expected: position === "input" ? "S" : "C",
        after: (ir) => ir.enums.TaskState?.values.push("blocked"),
      },
      {
        kind: "enum.value",
        case: "removed",
        position,
        expected: position === "input" ? "C" : "S",
        after: (ir) => ir.enums.TaskState?.values.pop(),
      },
      {
        kind: "order",
        case: "properties",
        position,
        expected: "info",
        after: (ir) => objectSchemaOf(ir, schema).properties.reverse(),
      },
      {
        kind: "name",
        case: "typeName",
        position,
        expected: "info",
        after: (ir) => {
          objectSchemaOf(ir, schema).typeName = "Renamed";
        },
      },
      {
        kind: "annotation",
        case: "docs",
        position,
        expected: "info",
        after: (ir) => {
          propertyOf(ir, schema, "title").docs = { summary: "The title." };
        },
      },
    ];
  }),
  {
    kind: "enum.value",
    case: "added",
    position: "output",
    expected: "-",
    note: " when output enums are open in both",
    base: (ir) => {
      ir.api.wire.outputEnums = "open";
    },
    after: (ir) => ir.enums.TaskState?.values.push("blocked"),
  },
  {
    kind: "enum.value",
    case: "added",
    position: "output",
    expected: "-",
    note: " on a narrowing when output enums are open in both",
    pointerFragment: "/narrowedTo/",
    base: (ir) => {
      ir.api.wire.outputEnums = "open";
      narrowTaskState(ir, "TaskState", ["open", "done"]);
    },
    after: (ir) => narrowTaskState(ir, "TaskState", ["open", "done", "archived"]),
  },
  {
    kind: "enum.value",
    case: "added",
    position: "output",
    expected: "C",
    note: " on a narrowing moved to a renamed enum of the same wire",
    pointerFragment: "/narrowedTo/",
    base: (ir) => narrowTaskState(ir, "TaskState", ["open", "done"]),
    after: (ir) => {
      const taskState = ir.enums.TaskState;

      if (taskState !== undefined) ir.enums.TaskState2 = { ...structuredClone(taskState), id: "TaskState2" };

      narrowTaskState(ir, "TaskState2", ["open", "done", "archived"]);
    },
  },
  {
    kind: "type.changed",
    case: "ref",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const input = operationOf(ir, "createTask").input;

      if (input !== undefined) input.schema = { kind: "ref", schema: "UpdateTask" };
    },
  },
  {
    kind: "type.changed",
    case: "ref",
    position: "output",
    expected: "CS",
    after: (ir) => {
      const [response] = operationOf(ir, "getTask").responses;

      if (response !== undefined) response.body = { kind: "ref", schema: "Channel" };
    },
  },
  {
    kind: "name",
    case: "schema",
    position: "input",
    expected: "info",
    note: " for a renamed schema of the same wire",
    after: (ir) => {
      const input = operationOf(ir, "createTask").input;

      ir.schemas.NewTask = { ...createSchema(ir), id: "NewTask" };

      if (input !== undefined) input.schema = { kind: "ref", schema: "NewTask" };
    },
  },
  {
    kind: "type.changed",
    case: "enum",
    position: "output",
    expected: "CS",
    after: (ir) => {
      propertyOf(ir, "Task", "state").type = { kind: "enum", enum: "Role" };
    },
  },
  {
    kind: "type.changed",
    case: "int64Wire",
    position: "output",
    expected: "CS",
    base: (ir) => {
      scalarOf(ir, "Task", "version").format = "int64";
    },
    after: (ir) => {
      ir.api.wire.int64 = "number";
    },
  },
  {
    kind: "type.changed",
    case: "outputEnums",
    position: "output",
    expected: "CS",
    after: (ir) => {
      ir.api.wire.outputEnums = "open";
    },
  },
  {
    kind: "type.changed",
    case: "urls",
    position: "output",
    expected: "CS",
    after: (ir) => {
      ir.api.wire.urls = "absolute";
    },
  },
  {
    kind: "type.changed",
    case: "body",
    position: "output",
    expected: "CS",
    after: (ir) => {
      const [response] = operationOf(ir, "getTask").responses;

      if (response !== undefined) delete response.body;
    },
  },
  {
    kind: "default.changed",
    case: "changed",
    position: "input",
    expected: "C",
    base: (ir) => {
      propertyOf(ir, "CreateTask", "effort").default = 1;
    },
    after: (ir) => {
      propertyOf(ir, "CreateTask", "effort").default = 2;
    },
  },
  {
    kind: "default.changed",
    case: "removed",
    position: "output",
    expected: "info",
    base: (ir) => {
      propertyOf(ir, "Task", "effort").default = 1;
    },
    after: (ir) => {
      delete propertyOf(ir, "Task", "effort").default;
    },
  },
  ...(
    [
      ["optional", "-"],
      ["required", "C"],
    ] as const
  ).map(
    ([paramCase, expected]): RowCase => ({
      kind: "param.added",
      case: paramCase,
      position: "input",
      expected,
      after: (ir) =>
        operationOf(ir, "listTasks").params.query.push({
          name: "label",
          type: { kind: "scalar", type: "string", refinements: {} },
          required: paramCase === "required",
          origin: ORIGIN,
        }),
    }),
  ),
  {
    kind: "param.removed",
    case: "required",
    position: "input",
    expected: "CS",
    after: (ir) => operationOf(ir, "getTask").params.path.pop(),
  },
  {
    kind: "param.removed",
    case: "optional",
    position: "input",
    expected: "C",
    note: " for a query param when after refuses unknown query",
    after: (ir) => operationOf(ir, "listTasks").params.query.shift(),
  },
  {
    kind: "param.removed",
    case: "optional",
    position: "input",
    expected: "-",
    note: " for a query param when after ignores unknown query",
    base: (ir) => {
      operationOf(ir, "listTasks").unknownQuery = {
        policy: "ignore",
        reason: "Trackers add keys.",
        origin: ORIGIN,
      };
    },
    after: (ir) => operationOf(ir, "listTasks").params.query.shift(),
  },
  {
    kind: "param.removed",
    case: "optional",
    position: "input",
    expected: "-",
    note: " for a header param",
    after: (ir) => operationOf(ir, "getTask").params.header.pop(),
  },
  {
    kind: "order",
    case: "params",
    position: "input",
    expected: "info",
    after: (ir) => operationOf(ir, "listTasks").params.query.reverse(),
  },
  {
    kind: "body",
    case: "added",
    position: "input",
    expected: "C",
    after: (ir) => {
      const create = operationOf(ir, "createTask").input;

      if (create !== undefined) operationOf(ir, "health").input = structuredClone(create);
    },
  },
  {
    kind: "body",
    case: "removed",
    position: "input",
    expected: "CS",
    after: (ir) => {
      delete operationOf(ir, "createTask").input;
    },
  },
  {
    kind: "body",
    case: "mediaRemoved",
    position: "input",
    expected: "C",
    after: (ir) => {
      const input = operationOf(ir, "createTask").input;

      if (input !== undefined) input.media = "application/x-www-form-urlencoded";
    },
  },
  {
    kind: "response",
    case: "added",
    position: "output",
    expected: "C",
    after: (ir) => addResponse(ir, 203),
  },
  {
    kind: "response",
    case: "removed",
    position: "output",
    expected: "S",
    base: (ir) => addResponse(ir, 203),
    after: (ir) => operationOf(ir, "getTask").responses.pop(),
  },
  {
    kind: "response",
    case: "changed",
    position: "output",
    expected: "CS",
    after: (ir) => {
      const [response] = operationOf(ir, "createTask").responses;

      if (response !== undefined) response.status = 200;
    },
  },
  {
    kind: "response",
    case: "mediaChanged",
    position: "output",
    expected: "CS",
    after: (ir) => {
      const [response] = operationOf(ir, "getTask").responses;

      if (response !== undefined) response.media = "application/xml";
    },
  },
  {
    kind: "maturity",
    case: "lowered",
    position: "none",
    expected: "C",
    base: (ir) => {
      operationOf(ir, "getTask").maturity.level = "stable";
    },
    after: (ir) => {
      operationOf(ir, "getTask").maturity.level = "provisional";
    },
  },
  {
    kind: "maturity",
    case: "raised",
    position: "none",
    expected: "info",
    after: (ir) => {
      ir.api.maturity = "stable";
    },
  },
  {
    kind: "deprecation",
    case: "added",
    position: "none",
    expected: "info",
    after: (ir) => deprecate(ir, "2027-01-01"),
  },
  {
    kind: "deprecation",
    case: "removed",
    position: "none",
    expected: "info",
    base: (ir) => deprecate(ir, "2027-01-01"),
    after: (ir) => {
      delete operationOf(ir, "getTask").deprecated;
    },
  },
  {
    kind: "deprecation",
    case: "sunsetLater",
    position: "none",
    expected: "info",
    base: (ir) => deprecate(ir, "2027-01-01"),
    after: (ir) => deprecate(ir, "2027-06-01"),
  },
  {
    kind: "deprecation",
    case: "sunsetEarlier",
    position: "none",
    expected: "C",
    base: (ir) => deprecate(ir, "2027-06-01"),
    after: (ir) => deprecate(ir, "2027-01-01"),
  },
  {
    kind: "deprecation",
    case: "successorChanged",
    position: "none",
    expected: "info",
    base: (ir) => deprecate(ir, "2027-01-01"),
    after: (ir) => deprecate(ir, "2027-01-01", "getDraft"),
  },
  {
    kind: "deprecation",
    case: "sinceChanged",
    position: "none",
    expected: "info",
    base: (ir) => deprecate(ir, "2027-01-01"),
    after: (ir) => {
      deprecate(ir, "2027-01-01");

      const deprecated = operationOf(ir, "getTask").deprecated;

      if (deprecated !== undefined) deprecated.since = "2026-02-01";
    },
  },
  {
    kind: "deprecation",
    case: "added",
    position: "none",
    expected: "info",
    note: " for a property",
    after: (ir) => {
      propertyOf(ir, "Task", "effort").deprecated = true;
    },
  },
  {
    kind: "compat.policy",
    case: "changed",
    position: "none",
    expected: "info",
    after: (ir) => {
      ir.api.compat.policy = "none";
    },
  },
  ...(
    [
      ["added", undefined, [{ name: "audit", version: "1.0.0" }]],
      ["removed", [{ name: "audit", version: "1.0.0" }], []],
      ["version", [{ name: "audit", version: "1.0.0" }], [{ name: "audit", version: "1.1.0" }]],
    ] as const
  ).map(
    ([packCase, beforePacks, afterPacks]): RowCase => ({
      kind: "pack.upgraded",
      case: packCase,
      position: "none",
      expected: "info",
      ...(beforePacks === undefined
        ? {}
        : {
            base: (ir) => {
              ir.packs = structuredClone([...beforePacks]);
            },
          }),
      after: (ir) => {
        ir.packs = structuredClone([...afterPacks]);
      },
    }),
  ),
  {
    kind: "order",
    case: "values",
    position: "output",
    expected: "info",
    after: (ir) => ir.enums.TaskState?.values.reverse(),
  },
  {
    kind: "order",
    case: "variants",
    position: "output",
    expected: "info",
    base: addShapeUnion,
    after: (ir) => shapeUnion(ir).variants.reverse(),
  },
  {
    kind: "order",
    case: "packs",
    position: "none",
    expected: "info",
    base: (ir) => {
      ir.packs = [
        { name: "audit", version: "1.0.0" },
        { name: "paging", version: "1.0.0" },
      ];
    },
    after: (ir) => ir.packs.reverse(),
  },
  {
    kind: "name",
    case: "name",
    position: "none",
    expected: "info",
    after: (ir) => {
      operationOf(ir, "getTask").name = { segments: ["read", "task"], role: "operation" };
    },
  },
  {
    kind: "annotation",
    case: "tags",
    position: "none",
    expected: "info",
    after: (ir) => operationOf(ir, "getTask").tags.push("reads"),
  },
  {
    kind: "unclassified",
    case: "Operation.errors",
    position: "none",
    expected: "CS",
    after: (ir) => operationOf(ir, "getTask").errors.pop(),
  },
  {
    kind: "unclassified",
    case: "Right.subject",
    position: "none",
    expected: "CS",
    note: " for a catalogue with no row yet",
    after: (ir) => {
      const right = Object.values(ir.rights)[0];

      if (right !== undefined) right.subject = { kind: "none" };
    },
  },
];

function narrowTaskState(ir: ContractIR, enumId: string, values: string[]): void {
  propertyOf(ir, "Task", "state").type = { kind: "enum", enum: enumId, narrowedTo: { values } };
}

function addResponse(ir: ContractIR, status: number): void {
  const operation = operationOf(ir, "getTask");
  const [response] = operation.responses;

  if (response !== undefined) operation.responses.push({ ...structuredClone(response), status });
}

describe("the classification table", () => {
  test.each(
    ROW_CASES.map((rowCase) => ({
      ...rowCase,
      name: `${rowCase.kind} ${rowCase.case} at ${rowCase.position}${rowCase.note ?? ""}`,
    })),
  )(
    "classifies $name",
    (rowCase) => {
      const base = rowCase.base === undefined ? goldenIr() : editedIr(rowCase.base);
      const after = editedIr(rowCase.after, base);
      const changes = changesOf(base, after);
      const change = changes.find(
        (candidate) =>
          candidate.kind === rowCase.kind &&
          candidate.case === rowCase.case &&
          candidate.position === rowCase.position &&
          candidate.pointer.includes(rowCase.pointerFragment ?? ""),
      );

      const unclassified = changes.filter(
        (candidate) => candidate.kind === "unclassified" && rowCase.kind !== "unclassified",
      );

      expect(change, `no ${rowCase.kind} ${rowCase.case} at ${rowCase.position}`).toBeDefined();
      expect(unclassified).toEqual([]);
      expect({ breaks: change?.breaks, classification: change?.classification }).toEqual(
        EXPECTED_OUTCOMES[rowCase.expected],
      );
    },
  );
});
