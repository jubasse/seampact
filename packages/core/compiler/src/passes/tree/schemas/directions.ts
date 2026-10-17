import type { IrWriter } from "@seampact/spec/ir";
import type { TreeSchemasCompiler } from "./compile.js";
import type { TreeSchemasReporter } from "./raw.js";

// Directions (ADR 0003 section 4): each position use carries the direction of its kind, and a named schema, enum
// or named format takes every direction it is reached in, through references, properties, items, map keys and
// values, variants and JSON content schemas. `unknownKeys` acts on input uses only: one written where every use
// is output is refused.

const DIRECTION_ORDER: readonly IrWriter.Direction[] = ["input", "output"];

interface DirectionTargets {
  readonly schemas: ReadonlyMap<string, IrWriter.Schema>;
  readonly enums: ReadonlyMap<string, IrWriter.Enum>;
  readonly scalars: ReadonlyMap<string, IrWriter.Scalar>;
}

// Adds a direction in the fixed order; false when it was already there, which ends the walk of a cycle.
function addDirection(directions: IrWriter.Direction[], direction: IrWriter.Direction): boolean {
  if (directions.includes(direction)) return false;
  directions.push(direction);
  directions.sort((a, b) => DIRECTION_ORDER.indexOf(a) - DIRECTION_ORDER.indexOf(b));

  return true;
}

function reach(
  use: IrWriter.TypeUse,
  direction: IrWriter.Direction,
  targets: DirectionTargets,
): void {
  switch (use.kind) {
    case "ref":
      reachSchema(use.schema, direction, targets);

      return;
    case "enum": {
      const declared = targets.enums.get(use.enum);

      if (declared !== undefined) addDirection(declared.directions, direction);

      return;
    }

    case "array":
      reach(use.items, direction, targets);

      return;
    case "scalar": {
      const named = use.scalar === undefined ? undefined : targets.scalars.get(use.scalar);

      if (named !== undefined) addDirection(named.directions, direction);

      if (use.content !== undefined) reach(use.content.schema, direction, targets);

      return;
    }

    case "file":
    case "opaque":
      return;
  }
}

function reachSchema(id: string, direction: IrWriter.Direction, targets: DirectionTargets): void {
  const schema = targets.schemas.get(id);

  if (schema === undefined || !addDirection(schema.directions, direction)) return;

  if (schema.kind === "object") {
    for (const property of schema.properties) reach(property.type, direction, targets);

    return;
  }

  if (schema.kind === "map") {
    if (schema.keys !== undefined) reach(schema.keys, direction, targets);
    reach(schema.values, direction, targets);

    return;
  }

  for (const variant of schema.variants) reachSchema(variant.schema, direction, targets);
}

/** Writes the directions of every schema, enum and named format from the position uses that reach it. */
export function treeSchemasWriteDirections(
  compiler: TreeSchemasCompiler,
  enums: readonly IrWriter.Enum[],
): void {
  const targets: DirectionTargets = {
    schemas: compiler.schemas,
    enums: new Map(enums.map((declared) => [declared.id, declared])),
    scalars: new Map(compiler.scalars.all().map((scalar) => [scalar.id, scalar])),
  };

  for (const [pointer, directions] of compiler.positionDirections) {
    const use = compiler.uses.get(pointer);

    if (use === undefined) continue;

    for (const direction of directions) reach(use, direction, targets);
  }
}

const within = (pointer: string, holder: string): boolean =>
  pointer === holder || pointer.startsWith(`${holder}/`);

interface DirectionHolder {
  pointer: string;
  directions: readonly IrWriter.Direction[];
}

// The directions of the nearest position or written schema holding `pointer`; none when no use reaches it yet.
function directionsAt(
  holders: readonly DirectionHolder[],
  pointer: string,
): readonly IrWriter.Direction[] {
  const nearest = holders
    .filter((holder) => within(pointer, holder.pointer))
    .sort((a, b) => b.pointer.length - a.pointer.length)[0];

  return nearest?.directions ?? [];
}

/**
 * Refuses each written `unknownKeys` whose nearest holder, a position or a written schema, is used in output
 * only. One on an alias declaration, which writes no schema, takes the directions of the uses that carry it. A
 * holder no use reaches yet (an unused declaration) is left alone.
 */
export function treeSchemasRefuseOutputUnknownKeys(
  compiler: TreeSchemasCompiler,
  reporter: TreeSchemasReporter,
): void {
  const holders: DirectionHolder[] = [
    ...[...compiler.positionDirections].map(([pointer, directions]) => ({ pointer, directions })),
    ...[...compiler.writtenAt].map(([id, pointer]) => ({
      pointer,
      directions: compiler.schemas.get(id)?.directions ?? [],
    })),
  ];

  for (const written of compiler.writtenUnknownKeys) {
    const own = directionsAt(holders, written);
    const directions =
      own.length > 0
        ? own
        : (compiler.unknownKeysUses.get(written) ?? []).flatMap((use) =>
            directionsAt(holders, use),
          );

    if (directions.length === 0 || directions.includes("input")) continue;
    reporter.error({
      rule: "unknown-keys",
      pointer: written,
      message: "'unknownKeys' acts on input uses only, and every use here is output",
      fix: "remove 'unknownKeys' here; an output use strips unknown keys on emit",
    });
  }
}
