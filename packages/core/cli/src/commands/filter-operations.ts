import type { OperationsFilter } from "@seampact/spec/config";
import type { ContractIR, Operation } from "@seampact/spec/ir";
import type { CliProblem } from "../cli-problem.js";

// What a target entry keeps of one api: a document of the api, then operation ids or tags.
export interface OperationSelection {
  document?: string;
  operations?: OperationsFilter;
}

export type FilterOutcome =
  | { status: "filtered"; ir: ContractIR }
  | { status: "refused"; problems: CliProblem[] };

// The api's IR with only the operations a target entry keeps, before the provider's `describe` and the target's
// `generate` read it: first the entry's `document` (its surfaces, and `internal: exclude` drops internal
// operations), then `operations.include` (empty keeps all) and `operations.exclude`, each item an operation id or
// a tag. Only `operations` shrinks; the rest of the IR is copied as it is. An unknown document, operation id or
// tag is refused, naming it and the api.
export function filterOperations(ir: ContractIR, selection: OperationSelection): FilterOutcome {
  const problems = unknownSelectionProblems(ir, selection);

  if (problems.length > 0) return { status: "refused", problems };

  const inDocument = ir.operations.filter((operation) =>
    isInDocument(ir, selection.document, operation),
  );
  const include = selection.operations?.include ?? [];
  const removedItems = include.filter(
    (item) => !inDocument.some((operation) => matches(operation, item)),
  );

  if (removedItems.length > 0) {
    return {
      status: "refused",
      problems: removedItems.map((item) => ({
        code: "filter.include.removed",
        message: `The api '${ir.api.id}' keeps no operation for the include item '${item}' once the document '${selection.document ?? "(none)"}' has run.`,
        fix: "Remove the item from `operations.include`, or choose a document that keeps it.",
      })),
    };
  }

  const exclude = selection.operations?.exclude ?? [];

  const kept = inDocument.filter(
    (operation) =>
      (include.length === 0 || include.some((item) => matches(operation, item))) &&
      !exclude.some((item) => matches(operation, item)),
  );

  return { status: "filtered", ir: { ...structuredClone(ir), operations: structuredClone(kept) } };
}

export function isInDocument(
  ir: ContractIR,
  documentId: string | undefined,
  operation: Operation,
): boolean {
  if (documentId === undefined) return true;

  const document = ir.api.documents[documentId];

  if (document === undefined) return false;

  if (document.internal === "exclude" && operation.internal) return false;

  return document.surfaces.includes(operation.surface);
}

function matches(operation: Operation, item: string): boolean {
  return operation.id === item || operation.tags.includes(item);
}

function unknownSelectionProblems(ir: ContractIR, selection: OperationSelection): CliProblem[] {
  const apiId = ir.api.id;
  const documentIds = Object.keys(ir.api.documents);

  const documentProblems: CliProblem[] =
    selection.document === undefined || documentIds.includes(selection.document)
      ? []
      : [
          {
            code: "filter.document.unknown",
            message: `The api '${apiId}' declares no document '${selection.document}' (${documentIds.join(", ") || "none declared"}).`,
            fix: "Name one of the api's `documents` in `document`, or remove `document`.",
          },
        ];

  const items = [
    ...(selection.operations?.include ?? []),
    ...(selection.operations?.exclude ?? []),
  ];
  const itemProblems = items
    .filter((item) => !ir.operations.some((operation) => matches(operation, item)))
    .map((item) => ({
      code: "filter.operation.unknown",
      message: `The api '${apiId}' has no operation id or tag '${item}'.`,
      fix: "Name an operation id or a tag of the api in `operations.include` or `operations.exclude`.",
    }));

  return [...documentProblems, ...itemProblems];
}
