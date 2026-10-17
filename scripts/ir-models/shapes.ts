import type { Definition, TypeRef } from "./model.ts";

// The shape table of ADR 0005 section 3 in a language-neutral form: what a native reader walks on the raw JSON to
// find an unknown tag or value of a must-act definition. Each emitter renders it in its own language. A member
// that holds no definition is not listed, and an opaque value or extension slot is data, never walked.

export type Shape =
  | { kind: "named"; definition: string }
  | { kind: "struct"; members: { name: string; shape: Shape }[] }
  | {
      kind: "union";
      tag: string;
      mustAct: boolean;
      variants: { tagValue: string; definition: string }[];
    }
  | { kind: "openEnum"; known: string[]; mustAct: boolean }
  | { kind: "items"; of: Shape }
  | { kind: "values"; of: Shape };

/** The shape of a definition, or undefined when the walk never enters it. */
export function shapeOfDefinition(definition: Definition): Shape | undefined {
  switch (definition.kind) {
    case "struct":
      return {
        kind: "struct",
        members: definition.members.flatMap((member) => {
          const shape = shapeOfType(member.type);
          return shape === undefined ? [] : [{ name: member.name, shape }];
        }),
      };
    case "union":
      return {
        kind: "union",
        tag: definition.tag,
        mustAct: definition.mustAct,
        variants: definition.variants.map(({ tagValue, definition: variant }) => ({
          tagValue,
          definition: variant,
        })),
      };
    case "openEnum":
      return { kind: "openEnum", known: definition.known, mustAct: definition.mustAct };
    case "alias":
      return shapeOfType(definition.target);
    case "extensionSlot":
      return undefined;
  }
}

function shapeOfType(type: TypeRef): Shape | undefined {
  switch (type.kind) {
    case "named":
      return { kind: "named", definition: type.definition };
    case "array": {
      const items = shapeOfType(type.items);
      return items === undefined ? undefined : { kind: "items", of: items };
    }
    case "map": {
      const values = shapeOfType(type.values);
      return values === undefined ? undefined : { kind: "values", of: values };
    }
    default:
      return undefined;
  }
}
