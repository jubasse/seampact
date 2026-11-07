import type { IrWriter } from "@seampact/spec/ir";

// A property the compiler writes itself (a core schema's field, a derived input's field): required or optional,
// never nullable, sensitive or deprecated, with no docs or extensions.

export function treeSchemasDerivedProperty(written: {
  name: string;
  type: IrWriter.TypeUse;
  optional: boolean;
  origin: IrWriter.Origin;
  derivedFrom?: IrWriter.DerivedFrom;
}): IrWriter.Property {
  const { derivedFrom, ...own } = written;

  return {
    ...own,
    nullable: false,
    sensitive: false,
    deprecated: false,
    docs: {},
    extensions: {},
    ...(derivedFrom === undefined ? {} : { derivedFrom }),
  };
}
