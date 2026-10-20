import {
  type ContractIR,
  isKnownVariant,
  type Operation,
  type RefTypeUse,
  type Response,
  type ResponseHeader,
  type TypeUse,
} from "@seampact/spec/ir";
import { goldenIr, objectSchemaOf, operationOf } from "../test-support.js";
import { type RowCase, testRowCases } from "./row-case.test-support.js";

// The response rows: shapes, response headers, the error codes an operation answers, field rights and list
// filters, each a reference IR pair. getPreferences answers 200 with a required `ETag`; createTask answers
// `api.rate_limited` with a `Retry-After` header; listTasks is filtered by `tasks.read`; `Task.effort` is
// restricted to `tasks.seeEffort`.

const ORIGIN = { layer: "api" as const, pointer: "/test" };

function firstResponse(ir: ContractIR, operation: string): Response {
  const [response] = operationOf(ir, operation).responses;

  if (response === undefined) throw new Error(`no response on ${operation}`);

  return response;
}

function etagHeader(ir: ContractIR): ResponseHeader {
  const [header] = firstResponse(ir, "getPreferences").headers;

  if (header === undefined) throw new Error("no ETag header on getPreferences");

  return header;
}

function newHeader(required: boolean): ResponseHeader {
  return {
    name: "X-Request-Cost",
    type: { kind: "scalar", type: "integer", refinements: {} },
    required,
    origin: ORIGIN,
  };
}

function rateLimited(operation: Operation) {
  const error = operation.errors.find((candidate) => candidate.code === "api.rate_limited");

  if (error === undefined) throw new Error(`no api.rate_limited on ${operation.id}`);

  return error;
}

function refUse(use: TypeUse | undefined): RefTypeUse {
  if (use === undefined || !isKnownVariant("TypeUse", use) || use.kind !== "ref")
    throw new Error("the test IR holds no reference there");

  return use;
}

function taskRef(ir: ContractIR): RefTypeUse {
  return refUse(firstResponse(ir, "getTask").body);
}

function createRef(ir: ContractIR): RefTypeUse {
  return refUse(operationOf(ir, "createTask").input?.schema);
}

const ROW_CASES: RowCase[] = [
  {
    kind: "response",
    case: "shape",
    position: "output",
    expected: "CS",
    after: (ir) => {
      firstResponse(ir, "getTask").shape = "list";
    },
  },
  {
    kind: "responseHeader.added",
    case: "optional",
    position: "output",
    expected: "-",
    after: (ir) => {
      firstResponse(ir, "getTask").headers.push(newHeader(false));
    },
  },
  {
    kind: "responseHeader.added",
    case: "required",
    position: "output",
    expected: "S",
    after: (ir) => {
      firstResponse(ir, "getTask").headers.push(newHeader(true));
    },
  },
  {
    kind: "responseHeader.removed",
    case: "required",
    position: "output",
    expected: "C",
    after: (ir) => {
      firstResponse(ir, "getPreferences").headers = [];
    },
  },
  {
    kind: "responseHeader.removed",
    case: "optional",
    position: "output",
    expected: "-",
    base: (ir) => {
      firstResponse(ir, "getTask").headers.push(newHeader(false));
    },
    after: (ir) => {
      firstResponse(ir, "getTask").headers = [];
    },
  },
  {
    kind: "responseHeader.required",
    case: "requiredToOptional",
    position: "output",
    expected: "C",
    after: (ir) => {
      etagHeader(ir).required = false;
    },
  },
  {
    kind: "responseHeader.required",
    case: "optionalToRequired",
    position: "output",
    expected: "S",
    base: (ir) => {
      etagHeader(ir).required = false;
    },
    after: (ir) => {
      etagHeader(ir).required = true;
    },
  },
  {
    kind: "responseHeader.semantic",
    case: "changed",
    position: "output",
    expected: "CS",
    after: (ir) => {
      etagHeader(ir).semantic = "versionToken";
    },
  },
  {
    kind: "type.changed",
    case: "scalarType",
    position: "output",
    expected: "CS",
    note: " for a response header",
    after: (ir) => {
      etagHeader(ir).type = { kind: "scalar", type: "integer", refinements: {} };
    },
  },
  {
    kind: "error",
    case: "added",
    position: "output",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "getTask").errors.push({ code: "state.conflict" });
    },
  },
  {
    kind: "error",
    case: "removed",
    position: "output",
    expected: "S",
    after: (ir) => {
      operationOf(ir, "getTask").errors.pop();
    },
  },
  {
    kind: "error",
    case: "roles",
    position: "output",
    expected: "CS",
    after: (ir) => {
      const [error] = operationOf(ir, "getTask").errors;

      if (error !== undefined) error.roles = [];
    },
  },
  {
    kind: "error",
    case: "retryHeaderRemoved",
    position: "output",
    expected: "C",
    after: (ir) => {
      delete rateLimited(operationOf(ir, "createTask")).retryHeader;
    },
  },
  {
    kind: "error",
    case: "retryHeaderAdded",
    position: "output",
    expected: "-",
    base: (ir) => {
      delete rateLimited(operationOf(ir, "createTask")).retryHeader;
    },
    after: (ir) => {
      const header = rateLimited(operationOf(goldenIr(), "createTask")).retryHeader;

      if (header !== undefined) rateLimited(operationOf(ir, "createTask")).retryHeader = header;
    },
  },
  {
    kind: "error",
    case: "retryHeaderChanged",
    position: "output",
    expected: "CS",
    after: (ir) => {
      const header = rateLimited(operationOf(ir, "createTask")).retryHeader;

      if (header !== undefined) header.unit = "ms";
    },
  },
  {
    kind: "filteredBy",
    case: "removed",
    position: "output",
    expected: "S",
    after: (ir) => {
      delete operationOf(ir, "listTasks").filteredBy;
    },
  },
  {
    kind: "filteredBy",
    case: "added",
    position: "output",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "listChannels").filteredBy = "tasks.read";
    },
  },
  {
    kind: "filteredBy",
    case: "changed",
    position: "output",
    expected: "CS",
    after: (ir) => {
      operationOf(ir, "listTasks").filteredBy = "roles";
    },
  },
  {
    kind: "fieldRight",
    case: "removed",
    position: "output",
    expected: "-",
    after: (ir) => {
      operationOf(ir, "getTask").fieldRights = [];
    },
  },
  {
    kind: "fieldRight",
    case: "added",
    position: "output",
    expected: "C",
    pointerFragment: "/fieldRights",
    after: (ir) => {
      const [fieldRight] = operationOf(ir, "getTask").fieldRights;

      if (fieldRight !== undefined)
        operationOf(ir, "getTask").fieldRights.push({ ...fieldRight, pointer: "/title" });
    },
  },
  {
    kind: "fieldRight",
    case: "changed",
    position: "output",
    expected: "CS",
    after: (ir) => {
      const [fieldRight] = operationOf(ir, "getTask").fieldRights;

      if (fieldRight !== undefined) fieldRight.right = "tasks.read";
    },
  },
  {
    kind: "fieldRight",
    case: "removed",
    position: "output",
    expected: "-",
    note: " for a property restriction",
    pointerFragment: "/schemas/Task",
    after: (ir) => {
      const effort = objectSchemaOf(ir, "Task").properties.find(
        (property) => property.name === "effort",
      );

      if (effort !== undefined) delete effort.restrictedTo;
    },
  },
  {
    kind: "unknownKeys",
    case: "kept",
    position: "output",
    expected: "C",
    after: (ir) => {
      taskRef(ir).unknownKeys = { policy: "keep", reason: "passthrough" };
    },
  },
  {
    kind: "unknownKeys",
    case: "ignored",
    position: "input",
    expected: "-",
    after: (ir) => {
      createRef(ir).unknownKeys = { policy: "ignore", reason: "lenient clients" };
    },
  },
  {
    kind: "unknownKeys",
    case: "kept",
    position: "input",
    expected: "S",
    after: (ir) => {
      createRef(ir).unknownKeys = { policy: "keep", reason: "passthrough" };
    },
  },
  {
    kind: "unknownKeys",
    case: "refused",
    position: "input",
    expected: "C",
    base: (ir) => {
      createRef(ir).unknownKeys = { policy: "ignore", reason: "lenient clients" };
    },
    after: (ir) => {
      delete createRef(ir).unknownKeys;
    },
  },
  {
    kind: "unknownKeys",
    case: "refused",
    position: "output",
    expected: "S",
    after: (ir) => {
      taskRef(ir).unknownKeys = { policy: "refuse" };
    },
  },
];

testRowCases("the response rows", ROW_CASES);
