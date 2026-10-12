import { irDefinition } from "./instance-walk.js";
import type { SchemaNode } from "./schemas.js";
import type { IrUnionMap } from "./types.generated.js";

// The tag member and known tags of a union definition, read from the schema files.
function unionTags(union: string): { tag: string; known: readonly string[] } {
  const def = irDefinition(union);
  const discriminator = def?.discriminator as SchemaNode | undefined;
  if (def === undefined || discriminator === undefined) throw new Error(`no IR union ${union}`);
  const tag = String(discriminator.propertyName);
  const known = (def.oneOf as SchemaNode[]).map((variant) => {
    const name = String(variant.$ref).slice(String(variant.$ref).lastIndexOf("/") + 1);
    const properties = irDefinition(name)?.properties as Record<string, SchemaNode> | undefined;
    return String(properties?.[tag]?.const);
  });
  return { tag, known };
}

const TAGS = new Map<string, { tag: string; known: readonly string[] }>();

// Narrows a value of a tagged union to its known variants (`Known<Union>`), on which a `switch` on the tag
// narrows as usual. `false` means an unknown variant: a reader that acts on it refuses it by name, with its
// tag and value (README.md); a must-act union already made the IR invalid.
export function isKnownVariant<N extends keyof IrUnionMap>(
  union: N,
  value: IrUnionMap[N]["union"],
): value is IrUnionMap[N]["known"] {
  let tags = TAGS.get(union);
  if (tags === undefined) {
    tags = unionTags(union);
    TAGS.set(union, tags);
  }
  const tag: unknown = (value as Record<string, unknown>)[tags.tag];
  return typeof tag === "string" && tags.known.includes(tag);
}
