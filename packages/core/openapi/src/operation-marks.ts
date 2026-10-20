import { below, type IrLocation } from "@seampact/codegen-core";
import { isKnownVariant, type Operation } from "@seampact/spec/ir";
import {
  type EmitContext,
  optionalReason,
  reasonValue,
  refuseUnknown,
  writeExtension,
} from "./emit-context.js";
import { valueSourceText } from "./ir-text.js";
import { type JsonObject, setDefined } from "./json-value.js";

// The operation marks of ADR 0004 section 12, each an `x-seampact-*` extension on the operation: concurrency,
// idempotency, owner, unknown query keys, budget, upstream services, maturity, degradation, deprecation, the
// internal mark, the relayed operation and a format other than the document's.

export function writeOperationMarks(
  context: EmitContext,
  operation: Operation,
  documentFormat: string | undefined,
  target: JsonObject,
  location: IrLocation,
): void {
  if (operation.concurrency !== undefined) {
    writeExtension(context, target, "concurrency", {
      version: valueSourceText(operation.concurrency.version),
      field: operation.concurrency.field,
    });
  }

  writeIdempotency(context, operation, target, location);

  if (operation.owner !== undefined) writeExtension(context, target, "owner", operation.owner.kind);

  writeUnknownQuery(context, operation, target, location);

  if (operation.budgetMs !== undefined)
    writeExtension(context, target, "budget-ms", operation.budgetMs);

  if (operation.upstream.length > 0)
    writeExtension(context, target, "upstream", [...operation.upstream]);

  const maturity: JsonObject = {
    level: operation.maturity.level,
    source: operation.maturity.source,
  };

  setDefined(maturity, "reason", optionalReason(context, operation.maturity.reason));
  writeExtension(context, target, "maturity", maturity);

  if (operation.degradable !== undefined) {
    const degradable: JsonObject = { paths: [...operation.degradable.paths] };

    setDefined(degradable, "header", operation.degradable.header);
    writeExtension(context, target, "degradable", degradable);
  }

  writeDeprecation(context, operation, target);

  if (operation.internal) writeExtension(context, target, "internal", true);

  if (operation.relays !== undefined) {
    writeExtension(context, target, "relays", {
      api: operation.relays.api,
      operationId: operation.relays.id,
    });
  }

  if (operation.format !== documentFormat)
    writeExtension(context, target, "format", operation.format);
}

function writeIdempotency(
  context: EmitContext,
  operation: Operation,
  target: JsonObject,
  location: IrLocation,
): void {
  const idempotency = operation.idempotency;

  if (idempotency === undefined) return;

  if (!isKnownVariant("Idempotency", idempotency)) {
    refuseUnknown(context, below(location, "idempotency", "kind"), idempotency.kind);

    return;
  }

  if (idempotency.kind === "exempt") {
    writeExtension(context, target, "idempotency", {
      exempt: reasonValue(context, idempotency.reason),
    });

    return;
  }

  writeExtension(context, target, "idempotency", {
    header: idempotency.header,
    replayHeader: idempotency.replayHeader,
    lifetimeMs: idempotency.lifetimeMs,
    required: idempotency.required,
    enforce: idempotency.enforce,
  });
}

function writeUnknownQuery(
  context: EmitContext,
  operation: Operation,
  target: JsonObject,
  location: IrLocation,
): void {
  const unknownQuery = operation.unknownQuery;

  if (!isKnownVariant("UnknownQuery", unknownQuery)) {
    refuseUnknown(context, below(location, "unknownQuery", "policy"), unknownQuery.policy);

    return;
  }

  if (unknownQuery.policy === "ignore") {
    writeExtension(context, target, "unknown-query", {
      ignore: reasonValue(context, unknownQuery.reason),
    });
  }
}

function writeDeprecation(context: EmitContext, operation: Operation, target: JsonObject): void {
  const deprecation = operation.deprecated;

  if (deprecation === undefined) return;

  const value: JsonObject = { since: deprecation.since, sunset: deprecation.sunset };

  if (deprecation.successor !== undefined) {
    value.successor = { api: deprecation.successor.api, operationId: deprecation.successor.id };
  }

  setDefined(value, "successorRel", deprecation.successorRel);
  writeExtension(context, target, "deprecation", value);
}
