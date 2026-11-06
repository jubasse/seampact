import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { identityResponseHeaderRefusals } from "./identity-headers.js";
import { readGoldenIr } from "./reference-project.test-support.js";

// The identity headers a server would write on a response (grammar section 9), refused by name at their declaration.

const SAFE_OPERATION = "getTask";

function tasksServiceWithTraceOnTheResponse(traceUse: "all" | "reads" | "writes"): ContractIR {
  const ir = readGoldenIr("tasksService");
  const trace = ir.headers.trace;
  const identity = ir.identities.service;

  if (trace === undefined || identity === undefined || !("headers" in identity))
    throw new Error("the golden tasksService api has no trace header on its service identity");

  trace.in = "response";

  for (const use of identity.headers) if (use.header === "trace") use.for = traceUse;

  return ir;
}

function refusalsOfSafeOperation(ir: ContractIR) {
  const operation = ir.operations.find((candidate) => candidate.id === SAFE_OPERATION);

  if (operation === undefined)
    throw new Error(`the golden api has no operation '${SAFE_OPERATION}'`);

  return identityResponseHeaderRefusals(ir, operation);
}

test("a header declared in a response is refused by name at its declaration", () => {
  const refusals = refusalsOfSafeOperation(tasksServiceWithTraceOnTheResponse("all"));

  expect(refusals).toHaveLength(1);
  expect(refusals[0]).toMatchObject({
    code: "identity.response.header.unsupported",
    member: "/headers/trace",
    operation: SAFE_OPERATION,
  });
});

test("a response header whose for excludes the operation is not refused on it", () => {
  expect(refusalsOfSafeOperation(tasksServiceWithTraceOnTheResponse("writes"))).toEqual([]);
  expect(refusalsOfSafeOperation(tasksServiceWithTraceOnTheResponse("reads"))).toHaveLength(1);
});
