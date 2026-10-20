import {
  isKnownVariant,
  type KnownSchema,
  type MapSchema,
  type ObjectSchema,
  type Property,
  type UnionSchema,
} from "@seampact/spec/ir";
import {
  type ChangeSite,
  compareKeptOrder,
  compareMembers,
  emitAt,
  refuseUnknownValue,
  type WalkContext,
  withoutPosition,
} from "./context.js";
import { compareText, pointerJoin } from "./json.js";
import { commonReaches, enumReachKey, scalarReachKey, schemaReachKey } from "./reach.js";
import { isSameWireSchema } from "./same-wire.js";
import { compareEnumValues, compareNullable, compareTypeUse } from "./type-use.js";

// The schemas, enums and scalars catalogues: each entry held by both IRs is compared once, its changes classified
// for every position and operation reaching it in both. An entry added or removed is classified at the uses that
// start or stop naming it.

export function compareSchemaCatalogue(context: WalkContext): void {
  for (const id of commonIds(context.before.schemas, context.after.schemas)) {
    const before = context.before.schemas[id];
    const after = context.after.schemas[id];

    if (before === undefined || after === undefined) continue;

    const reaches = commonReaches(context.beforeReach, context.afterReach, schemaReachKey(id));
    const pointer = pointerJoin("", "schemas", id);

    if (!isKnownVariant("Schema", before)) {
      refuseUnknownValue(context, { reaches }, pointerJoin(pointer, "kind"), before.kind);
      continue;
    }

    if (!isKnownVariant("Schema", after)) {
      refuseUnknownValue(context, { reaches }, pointerJoin(pointer, "kind"), after.kind);
      continue;
    }

    const site: ChangeSite = { reaches, origin: after.origin };

    compareSchema(context, site, pointer, before, after);
  }
}

export function compareEnumCatalogue(context: WalkContext): void {
  for (const id of commonIds(context.before.enums, context.after.enums)) {
    const before = context.before.enums[id];
    const after = context.after.enums[id];

    if (before === undefined || after === undefined) continue;

    const site: ChangeSite = {
      reaches: commonReaches(context.beforeReach, context.afterReach, enumReachKey(id)),
      origin: after.origin,
    };
    const pointer = pointerJoin("", "enums", id);

    compareMembers(context, site, "Enum", pointer, before, after, {
      values: (memberPointer) =>
        compareEnumValues(context, site, memberPointer, before.values, after.values),
    });
  }
}

export function compareScalarCatalogue(context: WalkContext): void {
  for (const id of commonIds(context.before.scalars, context.after.scalars)) {
    const before = context.before.scalars[id];
    const after = context.after.scalars[id];

    if (before === undefined || after === undefined) continue;

    const site: ChangeSite = {
      reaches: commonReaches(context.beforeReach, context.afterReach, scalarReachKey(id)),
      origin: after.origin,
    };

    // Every use holds the named format's type inline, and is compared where it is.
    compareMembers(context, site, "Scalar", pointerJoin("", "scalars", id), before, after, {
      type: () => undefined,
    });
  }
}

/** The ids both catalogues hold, sorted. */
export function commonIds(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  return Object.keys(after)
    .filter((id) => Object.hasOwn(before, id))
    .sort(compareText);
}

function compareSchema(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: KnownSchema,
  after: KnownSchema,
): void {
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

  const deprecated = (memberPointer: string, beforeValue: unknown, afterValue: unknown) =>
    emitAt(
      context,
      { ...site, reaches: withoutPosition(site.reaches) },
      {
        kind: "deprecation",
        case: afterValue === true ? "added" : "removed",
        pointer: memberPointer,
        before: beforeValue,
        after: afterValue,
      },
    );

  switch (before.kind) {
    case "object":
      if (after.kind === "object")
        compareObjectSchema(context, site, pointer, before, after, deprecated);

      return;
    case "map":
      if (after.kind === "map") compareMapSchema(context, site, pointer, before, after, deprecated);

      return;
    case "union":
      if (after.kind === "union")
        compareUnionSchema(context, site, pointer, before, after, deprecated);

      return;
  }
}

type FlagComparison = (pointer: string, before: unknown, after: unknown) => void;

function compareObjectSchema(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: ObjectSchema,
  after: ObjectSchema,
  deprecated: FlagComparison,
): void {
  compareMembers(context, site, "ObjectSchema", pointer, before, after, {
    deprecated,
    properties: (memberPointer) =>
      compareProperties(context, site, memberPointer, before.properties, after.properties),
  });
}

function compareProperties(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly Property[],
  after: readonly Property[],
): void {
  after.forEach((property, index) => {
    if (before.some((candidate) => candidate.name === property.name)) return;

    emitAt(
      context,
      { ...site, origin: property.origin },
      {
        kind: "property.added",
        case: property.optional ? "optional" : "required",
        pointer: pointerJoin(pointer, index),
        after: property.name,
      },
    );
  });

  before.forEach((property, index) => {
    const kept = after.findIndex((candidate) => candidate.name === property.name);

    if (kept === -1) {
      emitAt(
        context,
        { ...site, origin: property.origin },
        {
          kind: "property.removed",
          case: property.optional ? "optional" : "required",
          pointer: pointerJoin(pointer, index),
          before: property.name,
        },
      );

      return;
    }

    const afterProperty = after[kept];

    if (afterProperty !== undefined) {
      compareProperty(
        context,
        { ...site, origin: afterProperty.origin },
        pointerJoin(pointer, kept),
        property,
        afterProperty,
      );
    }
  });

  compareKeptOrder(context, site, pointer, "properties", before.map(nameOf), after.map(nameOf));
}

function nameOf(property: Property): string {
  return property.name;
}

function compareProperty(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Property,
  after: Property,
): void {
  compareMembers(context, site, "Property", pointer, before, after, {
    type: (memberPointer) => compareTypeUse(context, site, memberPointer, before.type, after.type),
    optional: (memberPointer) =>
      emitAt(context, site, {
        kind: "property.required",
        case: after.optional ? "requiredToOptional" : "optionalToRequired",
        pointer: memberPointer,
        before: before.optional,
        after: after.optional,
      }),
    nullable: (memberPointer) =>
      compareNullable(context, site, memberPointer, before.nullable, after.nullable),
    default: (memberPointer) =>
      emitDefaultChange(context, site, memberPointer, before.default, after.default),
    deprecated: (memberPointer) =>
      emitAt(
        context,
        { ...site, reaches: withoutPosition(site.reaches) },
        {
          kind: "deprecation",
          case: after.deprecated ? "added" : "removed",
          pointer: memberPointer,
          before: before.deprecated,
          after: after.deprecated,
        },
      ),
  });
}

/** A default added, changed or removed. */
export function emitDefaultChange(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: unknown,
  after: unknown,
): void {
  const defaultCase = before === undefined ? "added" : after === undefined ? "removed" : "changed";

  emitAt(context, site, { kind: "default.changed", case: defaultCase, pointer, before, after });
}

function compareMapSchema(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: MapSchema,
  after: MapSchema,
  deprecated: FlagComparison,
): void {
  compareMembers(context, site, "MapSchema", pointer, before, after, {
    deprecated,
    keys: (memberPointer) => {
      if (before.keys === undefined || after.keys === undefined) {
        emitAt(context, site, { kind: "type.changed", case: "keys", pointer: memberPointer });

        return;
      }

      compareTypeUse(context, site, memberPointer, before.keys, after.keys);
    },
    values: (memberPointer) =>
      compareTypeUse(context, site, memberPointer, before.values, after.values),
  });
}

function compareUnionSchema(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: UnionSchema,
  after: UnionSchema,
  deprecated: FlagComparison,
): void {
  compareMembers(context, site, "UnionSchema", pointer, before, after, {
    deprecated,
    tag: (memberPointer) => {
      if (!isKnownVariant("UnionTag", before.tag)) {
        refuseUnknownValue(context, site, pointerJoin(memberPointer, "in"), before.tag.in);

        return;
      }

      if (!isKnownVariant("UnionTag", after.tag)) {
        refuseUnknownValue(context, site, pointerJoin(memberPointer, "in"), after.tag.in);

        return;
      }

      emitAt(context, site, { kind: "union.tag", case: "changed", pointer: memberPointer });
    },
    variants: (memberPointer) => compareVariants(context, site, memberPointer, before, after),
  });
}

function compareVariants(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: UnionSchema,
  after: UnionSchema,
): void {
  after.variants.forEach((variant, index) => {
    if (before.variants.some((candidate) => candidate.tag === variant.tag)) return;

    emitAt(context, site, {
      kind: "union.variant",
      case: "added",
      pointer: pointerJoin(pointer, index),
      after: variant.tag,
    });
  });

  before.variants.forEach((variant, index) => {
    const kept = after.variants.findIndex((candidate) => candidate.tag === variant.tag);
    const afterVariant = after.variants[kept];

    if (afterVariant === undefined) {
      emitAt(context, site, {
        kind: "union.variant",
        case: "removed",
        pointer: pointerJoin(pointer, index),
        before: variant.tag,
      });

      return;
    }

    compareMembers(
      context,
      site,
      "UnionVariant",
      pointerJoin(pointer, kept),
      variant,
      afterVariant,
      {
        schema: (memberPointer) => {
          const sameWire = isSameWireSchema(
            context.before,
            variant.schema,
            context.after,
            afterVariant.schema,
          );

          emitAt(context, site, {
            kind: sameWire ? "name" : "type.changed",
            case: sameWire ? "schema" : "variantSchema",
            pointer: memberPointer,
            before: variant.schema,
            after: afterVariant.schema,
          });
        },
      },
    );
  });

  const tagOf = (variant: { tag: string }) => variant.tag;

  compareKeptOrder(
    context,
    site,
    pointer,
    "variants",
    before.variants.map(tagOf),
    after.variants.map(tagOf),
  );
}
