import { below, type IrLocation } from "@seampact/codegen-core";
import { isKnownVariant, type Operation, type Requirement } from "@seampact/spec/ir";
import {
  type EmitContext,
  refuseUnknown,
  writeConsumerExtensions,
  writeExtension,
} from "./emit-context.js";
import { valueSourceText } from "./ir-text.js";
import { copyOptional, type JsonObject, setDefined } from "./json-value.js";

// The rights rows of ADR 0004 section 12: principal requirements, bindings, scopes, requirements, field rights
// and the list filter, each as its `x-seampact-*` extension on the operation. A right's, rule's or scope's
// consumer extensions go on the item that names it.

export function writeOperationRights(
  context: EmitContext,
  operation: Operation,
  target: JsonObject,
  location: IrLocation,
): void {
  if (operation.principalRequires.length > 0) {
    writeExtension(
      context,
      target,
      "principal-requires",
      operation.principalRequires.map((requirement) => requirement.field),
    );
  }

  if (operation.bindings.length > 0) {
    writeExtension(
      context,
      target,
      "bindings",
      operation.bindings.map((binding, index) => ({
        from: valueSourceText(context, binding.from, below(location, "bindings", index, "from")),
        to: valueSourceText(context, binding.to, below(location, "bindings", index, "to")),
      })),
    );
  }

  if (operation.scopes.length > 0) {
    writeExtension(
      context,
      target,
      "scopes",
      operation.scopes.map((scope, index) =>
        scopeItem(context, scope, below(location, "scopes", index)),
      ),
    );
  }

  const requirements = operation.requires.flatMap((requirement, index) => {
    const item = requirementItem(context, requirement, below(location, "requires", index));

    return item === undefined ? [] : [item];
  });

  if (requirements.length > 0) writeExtension(context, target, "requires", requirements);

  if (operation.fieldRights.length > 0) {
    writeExtension(
      context,
      target,
      "restricted-to",
      operation.fieldRights.map((fieldRight, index) => {
        const item: JsonObject = {
          schema: fieldRight.schema,
          pointer: fieldRight.pointer,
          right: fieldRight.right,
        };
        const subjectLocation = below(location, "fieldRights", index, "subject", "source");

        setDefined(item, "params", copyOptional(fieldRight.params));
        setDefined(
          item,
          "subject",
          fieldRight.subject &&
            valueSourceText(context, fieldRight.subject.source, subjectLocation),
        );
        item.direction = fieldRight.direction;
        setDefined(item, "input", fieldRight.inputPolicy);
        setDefined(item, "always", fieldRight.always);

        return item;
      }),
    );
  }

  if (operation.filteredBy !== undefined)
    writeExtension(context, target, "filtered-by", operation.filteredBy);
}

function scopeItem(
  context: EmitContext,
  scope: Operation["scopes"][number],
  location: IrLocation,
): JsonObject {
  const item: JsonObject = {
    scope: scope.scope,
    from: valueSourceText(context, scope.source, below(location, "source")),
  };

  writeConsumerExtensions(item, context.ir.scopes[scope.scope]?.extensions ?? {});

  return item;
}

function requirementItem(
  context: EmitContext,
  requirement: Requirement,
  location: IrLocation,
): JsonObject | undefined {
  if (!isKnownVariant("Requirement", requirement)) {
    refuseUnknown(context, below(location, "kind"), requirement.kind);

    return undefined;
  }

  if (requirement.kind === "right") {
    const item: JsonObject = { right: requirement.right };

    setDefined(item, "params", copyOptional(requirement.params));
    setDefined(
      item,
      "subject",
      requirement.subject &&
        valueSourceText(context, requirement.subject.source, below(location, "subject", "source")),
    );
    setDefined(item, "entry", requirement.entry);
    writeConsumerExtensions(item, context.ir.rights[requirement.right]?.extensions ?? {});

    return item;
  }

  const item: JsonObject = { rule: requirement.rule };

  setDefined(item, "params", copyOptional(requirement.params));
  setDefined(item, "bucket", requirement.bucket);
  setDefined(item, "entry", requirement.entry);
  writeConsumerExtensions(item, context.ir.rules[requirement.rule]?.extensions ?? {});

  return item;
}
