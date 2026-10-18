import { walkIrInstance } from "./instance-walk.js";
import type * as IrWriter from "./types.writer.generated.js";

// The declarations a compiler pass may copy from an IR it read in the open form into the IR it writes, by
// definition name of the schema files, typed as the writer view.
export interface IrClosedDeclarations {
  Schema: IrWriter.Schema;
  Enum: IrWriter.Enum;
  Scalar: IrWriter.Scalar;
  WireFormat: IrWriter.WireFormat;
  ExtensionKeyDecl: IrWriter.ExtensionKeyDecl;
}

export type IrClosedDefinition = keyof IrClosedDeclarations;

// A union tag (pointer to the tag member) or an open-enum value outside what this IR revision knows.
export interface IrClosedUnknown {
  pointer: string;
  value: string;
}

export type IrClosedCheck<T> =
  | { closed: T; unknowns?: undefined }
  | { closed?: undefined; unknowns: IrClosedUnknown[] };

function isClosedAs<N extends IrClosedDefinition, V>(
  definition: N,
  declaration: V,
  pointer: string,
  unknowns: IrClosedUnknown[],
): declaration is V & IrClosedDeclarations[N] {
  walkIrInstance(
    declaration,
    (node) => {
      if (node.kind === "union") {
        const tag = node.value[node.tag];

        if (typeof tag === "string" && !node.known.includes(tag))
          unknowns.push({ pointer: `${node.pointer}/${node.tag}`, value: tag });
      } else if (node.kind === "openEnum" && !node.known.includes(node.value)) {
        unknowns.push({ pointer: node.pointer, value: node.value });
      }
    },
    { $ref: `#/$defs/${definition}` },
    pointer,
  );

  return unknowns.length === 0;
}

// Checks that a declaration read in the open form (an imported api's IR, already validated) holds only what
// this IR revision knows: every union tag a known variant, every open-enum value a known value. Then it is
// the writer type, returned as given (the caller copies it before storing it); else every unknown, with its
// pointer below `pointer`, for the caller to refuse by name. Members the schema does not know are not checked.
export function checkIrClosedDeclaration<N extends IrClosedDefinition, V>(
  definition: N,
  declaration: V,
  pointer = "",
): IrClosedCheck<V & IrClosedDeclarations[N]> {
  const unknowns: IrClosedUnknown[] = [];

  if (isClosedAs(definition, declaration, pointer, unknowns)) return { closed: declaration };

  return { unknowns };
}
