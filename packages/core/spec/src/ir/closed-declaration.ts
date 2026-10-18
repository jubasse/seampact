import { irDefinition, visitIrUnknown, walkIrInstance } from "./instance-walk.js";
import { escapePointer } from "./schema-walk.js";
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

// A union tag (pointer to the tag member), an open-enum value, or a member name (`value`, at the member's
// pointer) outside what this IR revision knows.
export interface IrClosedUnknown {
  pointer: string;
  value: string;
}

export type IrClosedCheck<T> =
  | { closed: T; unknowns?: undefined }
  | { closed?: undefined; unknowns: IrClosedUnknown[] };

function pushUnknownMembers(
  definition: string | undefined,
  value: Record<string, unknown>,
  pointer: string,
  unknowns: IrClosedUnknown[],
): void {
  const properties = definition === undefined ? undefined : irDefinition(definition)?.properties;

  if (typeof properties !== "object" || properties === null) return;

  for (const member of Object.keys(value))
    if (!Object.hasOwn(properties, member))
      unknowns.push({ pointer: `${pointer}/${escapePointer(member)}`, value: member });
}

function isClosedAs<N extends IrClosedDefinition, V>(
  definition: N,
  declaration: V,
  pointer: string,
  unknowns: IrClosedUnknown[],
): declaration is V & IrClosedDeclarations[N] {
  walkIrInstance(
    declaration,
    (node) => {
      visitIrUnknown(
        node,
        (unknown) =>
          unknowns.push({ pointer: `${unknown.pointer}/${unknown.tag}`, value: unknown.value }),
        (unknown) => unknowns.push({ pointer: unknown.pointer, value: unknown.value }),
      );

      if (node.kind === "object")
        pushUnknownMembers(node.definition, node.value, node.pointer, unknowns);
    },
    { $ref: `#/$defs/${definition}` },
    pointer,
  );

  return unknowns.length === 0;
}

// Checks that a declaration read in the open form (an imported api's IR, already validated) holds only what
// this IR revision knows: every union tag a known variant, every open-enum value a known value, every object
// member one the schema declares (a member name is reported as the value). Then it is
// the writer type, returned as given (the caller copies it before storing it); else every unknown, with its
// pointer below `pointer`, for the caller to refuse by name.
export function checkIrClosedDeclaration<N extends IrClosedDefinition, V>(
  definition: N,
  declaration: V,
  pointer = "",
): IrClosedCheck<V & IrClosedDeclarations[N]> {
  const unknowns: IrClosedUnknown[] = [];

  if (isClosedAs(definition, declaration, pointer, unknowns)) return { closed: declaration };

  return { unknowns };
}
