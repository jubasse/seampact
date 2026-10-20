import {
  type ArrayTypeUse,
  type EnumNarrowing,
  type EnumTypeUse,
  type FileTypeUse,
  isKnownVariant,
  type JsonContent,
  type KnownTypeUse,
  type Pattern,
  type RefTypeUse,
  type Refinements,
  type ScalarTypeUse,
  type TypeUse,
} from "@seampact/spec/ir";
import type { DiffFact } from "../table/rows.js";
import {
  type ChangeSite,
  compareKeptOrder,
  compareMembers,
  emitAt,
  refuseUnknownValue,
  type WalkContext,
} from "./context.js";
import { compareDecimals, isDecimalMultiple } from "./decimal.js";
import { pointerJoin } from "./json.js";
import { isSameWireEnum, isSameWireSchema } from "./same-wire.js";

// Compares two type uses at one site. A reference is compared by id only: the schema it names is compared once,
// in the catalogue, for every operation and position reaching it.

type RefinementCase = "tightened" | "loosened";

type BoundSide = "lower" | "upper";

export function compareTypeUse(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: TypeUse,
  after: TypeUse,
): void {
  if (!isKnownVariant("TypeUse", before)) {
    refuseUnknownValue(context, site, pointerJoin(pointer, "kind"), before.kind);

    return;
  }

  if (!isKnownVariant("TypeUse", after)) {
    refuseUnknownValue(context, site, pointerJoin(pointer, "kind"), after.kind);

    return;
  }

  if (before.kind !== after.kind) {
    emitAt(context, site, {
      kind: "type.changed",
      case: "kind",
      pointer,
      before: before.kind,
      after: after.kind,
    });

    return;
  }

  compareSameKind(context, site, pointer, before, after);
}

function compareSameKind(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: KnownTypeUse,
  after: KnownTypeUse,
): void {
  const nullable = (memberPointer: string, beforeValue: unknown, afterValue: unknown) =>
    compareNullable(context, site, memberPointer, beforeValue, afterValue);

  switch (before.kind) {
    case "ref":
      if (after.kind === "ref") compareRefUse(context, site, pointer, before, after, nullable);

      return;
    case "opaque":
      compareMembers(context, site, "OpaqueTypeUse", pointer, before, after, { nullable });

      return;
    case "file":
      if (after.kind === "file") compareFileUse(context, site, pointer, before, after, nullable);

      return;
    case "enum":
      if (after.kind === "enum") compareEnumUse(context, site, pointer, before, after, nullable);

      return;
    case "scalar":
      if (after.kind === "scalar")
        compareScalarUse(context, site, pointer, before, after, nullable);

      return;
    case "array":
      if (after.kind === "array") compareArrayUse(context, site, pointer, before, after, nullable);

      return;
  }
}

/** `nullable` added or removed; absent means false. */
export function compareNullable(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: unknown,
  after: unknown,
): void {
  const wasNullable = before === true;
  const isNullable = after === true;

  if (wasNullable === isNullable) return;

  emitAt(context, site, {
    kind: "nullable",
    case: isNullable ? "added" : "removed",
    pointer,
    before,
    after,
  });
}

type NullableComparison = (pointer: string, before: unknown, after: unknown) => void;

function compareRefUse(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: RefTypeUse,
  after: RefTypeUse,
  nullable: NullableComparison,
): void {
  compareMembers(context, site, "RefTypeUse", pointer, before, after, {
    nullable,
    schema: (memberPointer) => {
      const sameWire = isSameWireSchema(context.before, before.schema, context.after, after.schema);

      emitAt(context, site, {
        kind: sameWire ? "name" : "type.changed",
        case: sameWire ? "schema" : "ref",
        pointer: memberPointer,
        before: before.schema,
        after: after.schema,
      });
    },
  });
}

function compareFileUse(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: FileTypeUse,
  after: FileTypeUse,
  nullable: NullableComparison,
): void {
  compareMembers(context, site, "FileTypeUse", pointer, before, after, {
    nullable,
    media: (memberPointer) => {
      const removed = before.media.filter((media) => !after.media.includes(media));
      const added = after.media.filter((media) => !before.media.includes(media));

      for (const media of removed)
        emitRefinement(context, site, memberPointer, "tightened", media, undefined);

      for (const media of added)
        emitRefinement(context, site, memberPointer, "loosened", undefined, media);
    },
    maxSizeBytes: (memberPointer) =>
      compareBound(context, site, memberPointer, "upper", before.maxSizeBytes, after.maxSizeBytes),
  });
}

function compareEnumUse(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: EnumTypeUse,
  after: EnumTypeUse,
  nullable: NullableComparison,
): void {
  const sameEnum = before.enum === after.enum;

  compareMembers(context, site, "EnumTypeUse", pointer, before, after, {
    nullable,
    enum: (memberPointer) => {
      const sameWire = isSameWireEnum(context.before, before.enum, context.after, after.enum);

      emitAt(context, site, {
        kind: sameWire ? "name" : "type.changed",
        case: "enum",
        pointer: memberPointer,
        before: before.enum,
        after: after.enum,
      });
    },
    // A narrowing pins the values of this use: they are compared here, not through the catalogue enum.
    narrowedTo: (memberPointer) => {
      if (!sameEnum) return;

      const beforeValues =
        before.narrowedTo?.values ?? context.before.enums[before.enum]?.values ?? [];
      const afterValues = after.narrowedTo?.values ?? context.after.enums[after.enum]?.values ?? [];

      compareEnumValues(
        context,
        site,
        pointerJoin(memberPointer, "values"),
        beforeValues,
        afterValues,
      );
      compareNarrowingReason(context, site, memberPointer, before.narrowedTo, after.narrowedTo);
    },
  });
}

function compareNarrowingReason(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: EnumNarrowing | undefined,
  after: EnumNarrowing | undefined,
): void {
  if (before === undefined || after === undefined) return;

  compareMembers(context, site, "EnumNarrowing", pointer, before, after, {
    values: () => undefined,
  });
}

/** Values added and removed, then a reorder of the values both hold. */
export function compareEnumValues(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly string[],
  after: readonly string[],
  facts: readonly DiffFact[] = [],
): void {
  after.forEach((value, index) => {
    if (before.includes(value)) return;

    emitAt(context, site, {
      kind: "enum.value",
      case: "added",
      pointer: pointerJoin(pointer, index),
      after: value,
      facts,
    });
  });

  before.forEach((value, index) => {
    if (after.includes(value)) return;

    emitAt(context, site, {
      kind: "enum.value",
      case: "removed",
      pointer: pointerJoin(pointer, index),
      before: value,
      facts,
    });
  });

  compareKeptOrder(context, site, pointer, "values", before, after);
}

function compareScalarUse(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: ScalarTypeUse,
  after: ScalarTypeUse,
  nullable: NullableComparison,
): void {
  compareMembers(context, site, "ScalarTypeUse", pointer, before, after, {
    nullable,
    type: (memberPointer) =>
      emitAt(context, site, {
        kind: "type.changed",
        case: "scalarType",
        pointer: memberPointer,
        before: before.type,
        after: after.type,
      }),
    format: (memberPointer) =>
      emitAt(context, site, {
        kind: "type.changed",
        case: "format",
        pointer: memberPointer,
        before: before.format,
        after: after.format,
      }),
    refinements: (memberPointer) =>
      compareRefinements(context, site, memberPointer, before.refinements, after.refinements),
    content: (memberPointer) =>
      compareContent(context, site, memberPointer, before.content, after.content),
  });
}

function compareContent(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: JsonContent | undefined,
  after: JsonContent | undefined,
): void {
  if (before === undefined || after === undefined) {
    emitAt(context, site, {
      kind: "type.changed",
      case: "content",
      pointer,
      before: before?.media,
      after: after?.media,
    });

    return;
  }

  compareMembers(context, site, "JsonContent", pointer, before, after, {
    media: (memberPointer) =>
      emitAt(context, site, {
        kind: "type.changed",
        case: "content",
        pointer: memberPointer,
        before: before.media,
        after: after.media,
      }),
    schema: (memberPointer) =>
      compareTypeUse(context, site, memberPointer, before.schema, after.schema),
  });
}

function compareArrayUse(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: ArrayTypeUse,
  after: ArrayTypeUse,
  nullable: NullableComparison,
): void {
  compareMembers(context, site, "ArrayTypeUse", pointer, before, after, {
    nullable,
    items: (memberPointer) =>
      compareTypeUse(context, site, memberPointer, before.items, after.items),
    minItems: (memberPointer) =>
      compareBound(context, site, memberPointer, "lower", before.minItems, after.minItems),
    maxItems: (memberPointer) =>
      compareBound(context, site, memberPointer, "upper", before.maxItems, after.maxItems),
  });
}

function compareRefinements(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Refinements,
  after: Refinements,
): void {
  const bound = (side: BoundSide, member: keyof Refinements) => (memberPointer: string) =>
    compareBound(
      context,
      site,
      memberPointer,
      side,
      numericText(before[member]),
      numericText(after[member]),
    );

  compareMembers(context, site, "Refinements", pointer, before, after, {
    minLength: bound("lower", "minLength"),
    maxLength: bound("upper", "maxLength"),
    minimum: bound("lower", "minimum"),
    maximum: bound("upper", "maximum"),
    exclusiveMinimum: bound("lower", "exclusiveMinimum"),
    exclusiveMaximum: bound("upper", "exclusiveMaximum"),
    multipleOf: (memberPointer) =>
      compareMultipleOf(context, site, memberPointer, before.multipleOf, after.multipleOf),
    pattern: (memberPointer) =>
      comparePattern(context, site, memberPointer, before.pattern, after.pattern),
  });
}

function numericText(value: Refinements[keyof Refinements]): string | undefined {
  if (typeof value === "number") return String(value);

  return typeof value === "string" ? value : undefined;
}

// A bound added or moved inwards tightens; removed or moved outwards loosens.
function compareBound(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  side: BoundSide,
  before: string | number | undefined,
  after: string | number | undefined,
): void {
  const refinementCase = boundChange(
    side,
    before === undefined ? undefined : String(before),
    after === undefined ? undefined : String(after),
  );

  if (refinementCase !== undefined)
    emitRefinement(context, site, pointer, refinementCase, before, after);
}

function boundChange(
  side: BoundSide,
  before: string | undefined,
  after: string | undefined,
): RefinementCase | undefined {
  if (before === undefined && after === undefined) return undefined;

  if (before === undefined) return "tightened";

  if (after === undefined) return "loosened";

  const order = compareDecimals(after, before);

  if (order === 0) return undefined;

  const movedUp = order > 0;

  return movedUp === (side === "lower") ? "tightened" : "loosened";
}

function compareMultipleOf(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: string | undefined,
  after: string | undefined,
): void {
  if (before === undefined || after === undefined) {
    emitRefinement(
      context,
      site,
      pointer,
      before === undefined ? "tightened" : "loosened",
      before,
      after,
    );

    return;
  }

  if (compareDecimals(before, after) === 0) return;

  const refinementCase = isDecimalMultiple(after, before)
    ? "tightened"
    : isDecimalMultiple(before, after)
      ? "loosened"
      : "changed";

  emitAt(context, site, { kind: "refinement", case: refinementCase, pointer, before, after });
}

// A pattern added tightens and one removed loosens; an edited one cannot be ordered.
function comparePattern(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Pattern | undefined,
  after: Pattern | undefined,
): void {
  if (before === undefined || after === undefined) {
    emitRefinement(
      context,
      site,
      pointer,
      before === undefined ? "tightened" : "loosened",
      before?.source,
      after?.source,
    );

    return;
  }

  compareMembers(context, site, "Pattern", pointer, before, after, {
    normalized: (memberPointer) =>
      emitAt(context, site, {
        kind: "pattern.changed",
        case: "changed",
        pointer: memberPointer,
        before: before.source,
        after: after.source,
      }),
  });
}

function emitRefinement(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  refinementCase: RefinementCase,
  before: unknown,
  after: unknown,
): void {
  emitAt(context, site, { kind: "refinement", case: refinementCase, pointer, before, after });
}
