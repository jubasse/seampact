import type {
  Deprecation,
  InputField,
  InputProof,
  Operation,
  OperationInput,
  OperationMaturity,
  Param,
  Params,
  Response,
  ResponseHeader,
} from "@seampact/spec/ir";
import type { DiffPosition } from "../result.js";
import type { DiffFact } from "../table/rows.js";
import { accessComparisons } from "./access.js";
import { behaviourComparisons } from "./behaviour.js";
import { emitDefaultChange } from "./catalogue.js";
import {
  type ChangeSite,
  compareKeptOrder,
  compareKeyedList,
  compareMembers,
  emitAt,
  refuseUnknownValue,
  type WalkContext,
} from "./context.js";
import { compareText, pointerJoin } from "./json.js";
import { compareMaturityLevel } from "./maturity.js";
import type { ElementOrigin } from "./sink.js";
import { compareBound, compareTypeUse } from "./type-use.js";

// The operations, matched by id: added, removed, or compared member by member with their params and body at
// the input position and their success responses at the output position.

const HTTP_OPERATION_KIND = "httpOperation";

const PARAM_PLACES = ["path", "query", "header"] as const satisfies readonly (keyof Params)[];

const UNKNOWN_QUERY_REFUSE = "refuse";

export function compareOperations(context: WalkContext): void {
  const beforeIndexes = indexById(context.before.operations);
  const afterIndexes = indexById(context.after.operations);

  context.after.operations.forEach((operation, index) => {
    if (beforeIndexes.has(operation.id)) return;

    emitAt(context, operationSite(operation, "none", operation.origin), {
      kind: "operation.added",
      case: "added",
      pointer: pointerJoin("", "operations", index),
      after: operation.id,
    });
  });

  context.before.operations.forEach((operation, index) => {
    const afterIndex = afterIndexes.get(operation.id);
    const afterOperation =
      afterIndex === undefined ? undefined : context.after.operations[afterIndex];

    if (afterIndex === undefined || afterOperation === undefined) {
      emitAt(context, operationSite(operation, "none", operation.origin), {
        kind: "operation.removed",
        case: "removed",
        pointer: pointerJoin("", "operations", index),
        before: operation.id,
      });

      return;
    }

    compareOperation(context, pointerJoin("", "operations", afterIndex), operation, afterOperation);
  });
}

function indexById(operations: readonly Operation[]): Map<string, number> {
  return new Map(operations.map((operation, index) => [operation.id, index]));
}

function operationSite(
  operation: Operation,
  position: DiffPosition,
  origin: ElementOrigin | undefined,
): ChangeSite {
  return { reaches: [{ position, operations: [operation.id] }], origin };
}

function compareOperation(
  context: WalkContext,
  pointer: string,
  before: Operation,
  after: Operation,
): void {
  const site = operationSite(after, "none", after.origin);

  for (const operation of [before, after]) {
    if (operation.kind !== HTTP_OPERATION_KIND) {
      refuseUnknownValue(context, site, pointerJoin(pointer, "kind"), operation.kind);

      return;
    }
  }

  const route =
    (routeCase: string) => (memberPointer: string, beforeValue: unknown, afterValue: unknown) =>
      emitAt(context, site, {
        kind: "operation.route",
        case: routeCase,
        pointer: memberPointer,
        before: beforeValue,
        after: afterValue,
      });

  compareMembers(context, site, "Operation", pointer, before, after, {
    ...accessComparisons(context, before, after),
    ...behaviourComparisons(context, before, after),
    surface: route("surface"),
    method: route("method"),
    path: route("path"),
    params: (memberPointer) => compareParams(context, memberPointer, before, after),
    input: (memberPointer) => compareBody(context, memberPointer, after, before.input, after.input),
    responses: (memberPointer) =>
      compareResponses(context, memberPointer, after, before.responses, after.responses),
    deprecated: (memberPointer) =>
      compareDeprecation(context, site, memberPointer, before.deprecated, after.deprecated),
    maturity: (memberPointer) =>
      compareOperationMaturity(context, site, memberPointer, before.maturity, after.maturity),
    format: (memberPointer) =>
      emitAt(context, site, {
        kind: "operation.format",
        case: "changed",
        pointer: memberPointer,
        before: before.format,
        after: after.format,
      }),
  });
}

function compareParams(
  context: WalkContext,
  pointer: string,
  before: Operation,
  after: Operation,
): void {
  const site = operationSite(after, "input", after.origin);

  compareMembers(
    context,
    site,
    "Params",
    pointer,
    before.params,
    after.params,
    Object.fromEntries(
      PARAM_PLACES.map((place) => [
        place,
        (memberPointer: string) => {
          const facts: DiffFact[] =
            place === "query" && after.unknownQuery.policy === UNKNOWN_QUERY_REFUSE
              ? ["afterRefusesUnknownQuery"]
              : [];

          compareParamList(
            context,
            after,
            memberPointer,
            before.params[place],
            after.params[place],
            facts,
          );
        },
      ]),
    ),
  );
}

function compareParamList(
  context: WalkContext,
  operation: Operation,
  pointer: string,
  before: readonly Param[],
  after: readonly Param[],
  removalFacts: readonly DiffFact[],
): void {
  const site = operationSite(operation, "input", operation.origin);

  after.forEach((param, index) => {
    if (before.some((candidate) => candidate.name === param.name)) return;

    emitAt(
      context,
      { ...site, origin: param.origin },
      {
        kind: "param.added",
        case: param.required ? "required" : "optional",
        pointer: pointerJoin(pointer, index),
        after: param.name,
      },
    );
  });

  before.forEach((param, index) => {
    const kept = after.findIndex((candidate) => candidate.name === param.name);
    const afterParam = after[kept];

    if (afterParam === undefined) {
      emitAt(
        context,
        { ...site, origin: param.origin },
        {
          kind: "param.removed",
          case: param.required ? "required" : "optional",
          pointer: pointerJoin(pointer, index),
          before: param.name,
          facts: removalFacts,
        },
      );

      return;
    }

    const paramSite: ChangeSite = { ...site, origin: afterParam.origin };

    compareMembers(context, paramSite, "Param", pointerJoin(pointer, kept), param, afterParam, {
      type: (memberPointer) =>
        compareTypeUse(context, paramSite, memberPointer, param.type, afterParam.type),
      default: (memberPointer) =>
        emitDefaultChange(context, paramSite, memberPointer, param.default, afterParam.default),
      required: (memberPointer) =>
        emitAt(context, paramSite, {
          kind: "param.required",
          case: afterParam.required ? "optionalToRequired" : "requiredToOptional",
          pointer: memberPointer,
          before: param.required,
          after: afterParam.required,
        }),
    });
  });

  const nameOf = (param: Param) => param.name;

  compareKeptOrder(context, site, pointer, "params", before.map(nameOf), after.map(nameOf));
}

function compareBody(
  context: WalkContext,
  pointer: string,
  operation: Operation,
  before: OperationInput | undefined,
  after: OperationInput | undefined,
): void {
  if (before === undefined || after === undefined) {
    const site = operationSite(operation, "input", (after ?? before)?.origin);

    emitAt(context, site, {
      kind: "body",
      case: after === undefined ? "removed" : "added",
      pointer,
    });

    return;
  }

  const site = operationSite(operation, "input", after.origin);

  compareMembers(context, site, "OperationInput", pointer, before, after, {
    // One media type per body: a change removes the old one, which a client still sends.
    media: (memberPointer) =>
      emitAt(context, site, {
        kind: "body",
        case: "mediaRemoved",
        pointer: memberPointer,
        before: before.media,
        after: after.media,
      }),
    schema: (memberPointer) =>
      compareTypeUse(context, site, memberPointer, before.schema, after.schema),
    bodyLimitBytes: (memberPointer) =>
      compareBound(
        context,
        site,
        memberPointer,
        "upper",
        before.bodyLimitBytes,
        after.bodyLimitBytes,
      ),
    fields: (memberPointer) =>
      compareInputFields(context, site, memberPointer, before.fields ?? [], after.fields ?? []),
    proofs: (memberPointer) =>
      compareProofs(context, site, memberPointer, before.proofs ?? [], after.proofs ?? []),
  });
}

// A form field follows a top-level body property, whose rows classify it added or removed.
function compareInputFields(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly InputField[],
  after: readonly InputField[],
): void {
  const followsProperty = (entryPointer: string, field: InputField) =>
    emitAt(context, site, {
      kind: "annotation",
      case: "fields",
      pointer: entryPointer,
      after: field.name,
    });

  compareKeyedList(pointer, before, after, {
    keyOf: (field) => field.name,
    added: followsProperty,
    removed: followsProperty,
    kept: (entryPointer, beforeField, afterField) =>
      compareMembers(context, site, "InputField", entryPointer, beforeField, afterField, {}),
  });
}

function compareProofs(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly InputProof[],
  after: readonly InputProof[],
): void {
  compareKeyedList(pointer, before, after, {
    keyOf: (proof) => proof.name,
    added: (entryPointer, proof) =>
      emitAt(context, site, {
        kind: "proof",
        case: "added",
        pointer: entryPointer,
        after: proof.name,
      }),
    removed: (entryPointer, proof) =>
      emitAt(context, site, {
        kind: "proof",
        case: "removed",
        pointer: entryPointer,
        before: proof.name,
      }),
    kept: (entryPointer, beforeProof, afterProof) =>
      compareMembers(context, site, "InputProof", entryPointer, beforeProof, afterProof, {
        schema: (memberPointer) =>
          compareTypeUse(context, site, memberPointer, beforeProof.schema, afterProof.schema),
      }),
  });
}

function compareResponses(
  context: WalkContext,
  pointer: string,
  operation: Operation,
  before: readonly Response[],
  after: readonly Response[],
): void {
  const site = operationSite(operation, "output", operation.origin);
  const removed = before.filter(
    (response) => !after.some((candidate) => candidate.status === response.status),
  );
  const added = after.filter(
    (response) => !before.some((candidate) => candidate.status === response.status),
  );
  const [removedOnly] = removed;
  const [addedOnly] = added;

  // One success status replaced by another: the same response under a new status.
  if (
    removed.length === 1 &&
    added.length === 1 &&
    removedOnly !== undefined &&
    addedOnly !== undefined
  ) {
    const responsePointer = pointerJoin(pointer, after.indexOf(addedOnly));

    emitAt(
      context,
      { ...site, origin: addedOnly.origin },
      {
        kind: "response",
        case: "changed",
        pointer: responsePointer,
        before: removedOnly.status,
        after: addedOnly.status,
      },
    );
    compareResponse(context, operation, responsePointer, removedOnly, addedOnly);
  } else {
    for (const response of added) {
      emitAt(
        context,
        { ...site, origin: response.origin },
        {
          kind: "response",
          case: "added",
          pointer: pointerJoin(pointer, after.indexOf(response)),
          after: response.status,
        },
      );
    }

    for (const response of removed) {
      emitAt(
        context,
        { ...site, origin: response.origin },
        {
          kind: "response",
          case: "removed",
          pointer: pointerJoin(pointer, before.indexOf(response)),
          before: response.status,
        },
      );
    }
  }

  after.forEach((response, index) => {
    const beforeResponse = before.find((candidate) => candidate.status === response.status);

    if (beforeResponse !== undefined)
      compareResponse(context, operation, pointerJoin(pointer, index), beforeResponse, response);
  });
}

function compareResponse(
  context: WalkContext,
  operation: Operation,
  pointer: string,
  before: Response,
  after: Response,
): void {
  const site = operationSite(operation, "output", after.origin);

  compareMembers(context, site, "Response", pointer, before, after, {
    status: () => undefined,
    media: (memberPointer) =>
      emitAt(context, site, {
        kind: "response",
        case: "mediaChanged",
        pointer: memberPointer,
        before: before.media,
        after: after.media,
      }),
    body: (memberPointer) => {
      if (before.body === undefined || after.body === undefined) {
        emitAt(context, site, { kind: "type.changed", case: "body", pointer: memberPointer });

        return;
      }

      compareTypeUse(context, site, memberPointer, before.body, after.body);
    },
    headers: (memberPointer) =>
      compareResponseHeaders(context, site, memberPointer, before.headers, after.headers),
  });
}

// Response headers act as output properties: a client reads the required ones, a handler must send them.
function compareResponseHeaders(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly ResponseHeader[],
  after: readonly ResponseHeader[],
): void {
  const requiredCase = (header: ResponseHeader) => (header.required ? "required" : "optional");

  compareKeyedList(pointer, before, after, {
    keyOf: (header) => header.name.toLowerCase(),
    added: (entryPointer, header) =>
      emitAt(context, site, {
        kind: "responseHeader.added",
        case: requiredCase(header),
        pointer: entryPointer,
        after: header.name,
      }),
    removed: (entryPointer, header) =>
      emitAt(context, site, {
        kind: "responseHeader.removed",
        case: requiredCase(header),
        pointer: entryPointer,
        before: header.name,
      }),
    kept: (entryPointer, beforeHeader, afterHeader) =>
      compareMembers(context, site, "ResponseHeader", entryPointer, beforeHeader, afterHeader, {
        name: (memberPointer) =>
          emitAt(context, site, {
            kind: "annotation",
            case: "name",
            pointer: memberPointer,
            before: beforeHeader.name,
            after: afterHeader.name,
          }),
        type: (memberPointer) =>
          compareTypeUse(context, site, memberPointer, beforeHeader.type, afterHeader.type),
        required: (memberPointer) =>
          emitAt(context, site, {
            kind: "responseHeader.required",
            case: afterHeader.required ? "optionalToRequired" : "requiredToOptional",
            pointer: memberPointer,
            before: beforeHeader.required,
            after: afterHeader.required,
          }),
      }),
  });
}

function compareDeprecation(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Deprecation | undefined,
  after: Deprecation | undefined,
): void {
  if (before === undefined || after === undefined) {
    emitAt(context, site, {
      kind: "deprecation",
      case: after === undefined ? "removed" : "added",
      pointer,
      before: before?.sunset,
      after: after?.sunset,
    });

    return;
  }

  const successorChanged = () =>
    emitAt(context, site, {
      kind: "deprecation",
      case: "successorChanged",
      pointer,
      before: before.successor?.id,
      after: after.successor?.id,
    });

  compareMembers(context, site, "Deprecation", pointer, before, after, {
    since: (memberPointer) =>
      emitAt(context, site, {
        kind: "deprecation",
        case: "sinceChanged",
        pointer: memberPointer,
        before: before.since,
        after: after.since,
      }),
    // Calendar dates order as text.
    sunset: (memberPointer) =>
      emitAt(context, site, {
        kind: "deprecation",
        case: compareText(after.sunset, before.sunset) > 0 ? "sunsetLater" : "sunsetEarlier",
        pointer: memberPointer,
        before: before.sunset,
        after: after.sunset,
      }),
    successor: successorChanged,
    successorRel: successorChanged,
  });
}

function compareOperationMaturity(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: OperationMaturity,
  after: OperationMaturity,
): void {
  compareMembers(context, site, "OperationMaturity", pointer, before, after, {
    level: (memberPointer) =>
      compareMaturityLevel(context, site, memberPointer, before.level, after.level),
  });
}
