import type { ContractIR, Deprecation, Operation, Schema } from "@seampact/spec/ir";
import type { DeprecationEntry, OperationDeprecationStatus } from "../result.js";
import { compareText, pointerJoin } from "../walk/json.js";

// The deprecation report (FR-13, SCN-051): each operation deprecated in `after`, each operation deprecated in
// `before` and gone from `after`, and each schema or property whose `deprecated` flag changed.

const DAY_MILLISECONDS = 86_400_000;

export function deprecationReport(
  before: ContractIR,
  after: ContractIR,
  today: string,
): DeprecationEntry[] {
  const entries = [...operationEntries(before, after, today), ...schemaEntries(before, after)];

  return entries.sort(
    (left, right) =>
      compareText(
        left.subject === "operation" ? left.operation : "",
        right.subject === "operation" ? right.operation : "",
      ) || compareText(left.pointer, right.pointer),
  );
}

function operationEntries(
  before: ContractIR,
  after: ContractIR,
  today: string,
): DeprecationEntry[] {
  const entries: DeprecationEntry[] = [];
  const afterIds = new Set(after.operations.map((operation) => operation.id));

  after.operations.forEach((operation, index) => {
    if (operation.deprecated === undefined) return;

    const previous = before.operations.find(
      (candidate) => candidate.id === operation.id,
    )?.deprecated;
    const status = afterStatus(previous, operation.deprecated);

    entries.push(
      operationEntry(
        operation,
        operation.deprecated,
        pointerJoin("", "operations", index, "deprecated"),
        status,
        today,
      ),
    );
  });

  before.operations.forEach((operation, index) => {
    if (operation.deprecated === undefined || afterIds.has(operation.id)) return;

    const status = operation.deprecated.sunset <= today ? "sunsetPassed" : "removed";

    entries.push(
      operationEntry(
        operation,
        operation.deprecated,
        pointerJoin("", "operations", index, "deprecated"),
        status,
        today,
      ),
    );
  });

  return entries;
}

function afterStatus(
  previous: Deprecation | undefined,
  current: Deprecation,
): OperationDeprecationStatus {
  if (previous === undefined) return "new";

  if (current.sunset < previous.sunset) return "sunsetEarlier";

  if (current.sunset > previous.sunset) return "sunsetLater";

  if (
    previous.successor?.id !== current.successor?.id ||
    previous.successorRel !== current.successorRel
  ) {
    return "successorChanged";
  }

  return "kept";
}

function operationEntry(
  operation: Operation,
  deprecation: Deprecation,
  pointer: string,
  status: OperationDeprecationStatus,
  today: string,
): DeprecationEntry {
  const daysToSunset = Math.round(
    (Date.parse(deprecation.sunset) - Date.parse(today)) / DAY_MILLISECONDS,
  );

  return {
    subject: "operation",
    operation: operation.id,
    pointer,
    status,
    since: deprecation.since,
    sunset: deprecation.sunset,
    ...(deprecation.successor === undefined ? {} : { successor: deprecation.successor.id }),
    daysToSunset,
    pastSunset: deprecation.sunset <= today,
  };
}

function schemaEntries(before: ContractIR, after: ContractIR): DeprecationEntry[] {
  const entries: DeprecationEntry[] = [];

  for (const [id, schema] of Object.entries(after.schemas)) {
    const previous = before.schemas[id];

    if (previous === undefined) continue;

    const pointer = pointerJoin("", "schemas", id);

    if (flagOf(previous) !== flagOf(schema)) {
      entries.push({
        subject: "schema",
        pointer,
        schema: id,
        status: flagOf(schema) ? "deprecated" : "undeprecated",
      });
    }

    entries.push(...propertyEntries(id, pointer, previous, schema));
  }

  return entries;
}

function flagOf(schema: Schema): boolean {
  return "deprecated" in schema && schema.deprecated === true;
}

function propertyEntries(
  id: string,
  pointer: string,
  before: Schema,
  after: Schema,
): DeprecationEntry[] {
  if (!("properties" in before) || !("properties" in after)) return [];

  return after.properties.flatMap((property, index) => {
    const previous = before.properties.find((candidate) => candidate.name === property.name);

    if (previous === undefined || previous.deprecated === property.deprecated) return [];

    return [
      {
        subject: "property" as const,
        pointer: pointerJoin(pointer, "properties", index),
        schema: id,
        property: property.name,
        status: property.deprecated ? ("deprecated" as const) : ("undeprecated" as const),
      },
    ];
  });
}
