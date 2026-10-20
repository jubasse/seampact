import { below, type IrLocation } from "@seampact/codegen-core";
import type { Operation, OperationExample, Response, WireFormat } from "@seampact/spec/ir";
import { emittedShapeOf } from "./body-slots.js";
import { type EmitContext, refuseNotEmitted } from "./emit-context.js";
import { copyJsonValue, type JsonObject, type JsonValue } from "./json-value.js";
import { renderTemplate } from "./templates.js";

// The `examples` row of ADR 0004 section 12: each route example in the request body's `examples`, or in the
// response of its status, its value written through the format's shape.

const PAYLOAD_SLOT = "payload";

export interface ExampleSet {
  /** The request examples, as a Media Type Object's `examples`; absent when there is none. */
  request?: JsonObject;
  /** The response examples by name, with the status each belongs to. */
  responses: { name: string; status: number; example: OperationExample; location: IrLocation }[];
}

export function collectExamples(context: EmitContext, operation: Operation, location: IrLocation): ExampleSet {
  const set: ExampleSet = { responses: [] };
  const defaultStatus = operation.responses[0]?.status;

  for (const [name, example] of Object.entries(operation.examples)) {
    const exampleLocation = below(location, "examples", name);

    if (example.request === true) {
      set.request ??= {};
      set.request[name] = { value: copyJsonValue(example.value) };
      continue;
    }

    if (example.error !== undefined) {
      refuseNotEmitted(context, "example.error", "An error example", exampleLocation);
      continue;
    }

    const status = example.status ?? defaultStatus;

    if (status === undefined) {
      refuseNotEmitted(context, "example.status", "An example without a success response", exampleLocation);
      continue;
    }

    set.responses.push({ name, status, example, location: exampleLocation });
  }

  return set;
}

/** The examples of one success response, rendered through the format's shape. */
export function responseExamples(
  context: EmitContext,
  format: WireFormat,
  response: Response,
  set: ExampleSet,
  location: IrLocation,
): JsonObject | undefined {
  const own = set.responses.filter((entry) => entry.status === response.status);

  if (own.length === 0) return undefined;

  const shape = emittedShapeOf(response.shape);

  if (shape === undefined || shape === "page") {
    for (const entry of own) {
      refuseNotEmitted(context, "example.shape", `An example of a '${response.shape}' response`, entry.location);
    }

    return undefined;
  }

  const examples: JsonObject = {};

  for (const entry of own) {
    const values = new Map<string, JsonValue>([[PAYLOAD_SLOT, copyJsonValue(entry.example.value)]]);
    const rendered = renderTemplate(context, format.success[shape].body, values, below(location, "examples"));

    if (rendered !== undefined) examples[entry.name] = { value: rendered };
  }

  return examples;
}
