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
  PagingStyle: IrWriter.PagingStyle;
  Operation: IrWriter.Operation;
  TypeUse: IrWriter.TypeUse;
}

export type IrClosedDefinition = keyof IrClosedDeclarations;

// A union tag (pointer to the tag member), an open-enum value, or a member name (`value`, at the member's
// pointer) outside what this IR revision knows, or a tag or enum value that is missing or not a string
// (`value` is then its kind). `value` and a member name in `pointer` are bounded: they are read from an
// untrusted document.
export interface IrClosedUnknown {
  pointer: string;
  value: string;
}

const MAX_UNKNOWN_VALUE_LENGTH = 64;

const ELLIPSIS = "...";

/** A string cut to the bound; any other value replaced by its kind. */
export function boundedUnknownValue(value: unknown): string {
  if (typeof value === "string")
    return value.length <= MAX_UNKNOWN_VALUE_LENGTH
      ? value
      : `${value.slice(0, MAX_UNKNOWN_VALUE_LENGTH)}${ELLIPSIS}`;

  if (value === null) return "null";

  if (Array.isArray(value)) return "array";

  return typeof value;
}

function pushUnknown(unknowns: IrClosedUnknown[], pointer: string, value: unknown): void {
  unknowns.push({ pointer, value: boundedUnknownValue(value) });
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
      pushUnknown(unknowns, `${pointer}/${escapePointer(boundedUnknownValue(member))}`, member);
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
        (unknown) => pushUnknown(unknowns, `${unknown.pointer}/${unknown.tag}`, unknown.value),
        (unknown) => pushUnknown(unknowns, unknown.pointer, unknown.value),
      );

      if (node.kind === "union" && typeof node.value[node.tag] !== "string")
        pushUnknown(unknowns, `${node.pointer}/${node.tag}`, node.value[node.tag]);

      if (node.kind === "malformedOpenEnum") pushUnknown(unknowns, node.pointer, node.value);

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
// member one the schema declares (a member name is reported as the value), and every tag and open-enum value
// present as a string. When it holds, the declaration is the writer type, returned as given (the caller
// copies it before storing it); else every unknown, with its pointer below `pointer`, for the caller to
// refuse by name.
export function checkIrClosedDeclaration<N extends IrClosedDefinition, V>(
  definition: N,
  declaration: V,
  pointer = "",
): IrClosedCheck<V & IrClosedDeclarations[N]> {
  const unknowns: IrClosedUnknown[] = [];

  if (isClosedAs(definition, declaration, pointer, unknowns)) return { closed: declaration };

  return { unknowns };
}
