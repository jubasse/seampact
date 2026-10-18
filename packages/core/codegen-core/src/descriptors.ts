import type { Direction, OperationId, SchemaId } from "@seampact/spec/ir";

// A generated export a descriptor points at. `module` is a POSIX path relative to the provider's output root,
// without extension; a consumer joins it to the link's location to write its import.
export interface ExportRef {
  module: string;
  export: string;
}

// The directions a schema entry carries an export for. A provider refuses a direction it does not know
// (ADR 0005 section 3), never skips it.
export type SchemaDirection = Extract<Direction, "input" | "output">;

// One export per direction the schema is used in (its `directions` in the IR).
export type SchemaExports = { readonly [Each in SchemaDirection]?: ExportRef };

// What a validator target provides (ADR 0009 "The provider seam"). Each export is a Standard Schema v1 value.
export interface ValidatorsDescriptor {
  kind: "validators";
  style: "standard-schema";
  schemas: Readonly<Record<SchemaId, SchemaExports>>;
  operations: Readonly<Record<OperationId, OperationValidatorExports>>;
}

export interface OperationValidatorExports {
  // Validates the whole request, `{ path, query, headers, body }` after query decoding, in one call, each member
  // present when the operation declares it (ADR 0012 "The check order").
  input: ExportRef;
}

// What the types target provides: each export is a TypeScript type, so a target never re-emits another's types.
export interface TypesDescriptor {
  kind: "types";
  style: "typescript";
  schemas: Readonly<Record<SchemaId, SchemaExports>>;
  operations: Readonly<Record<OperationId, OperationTypeExports>>;
}

export interface OperationTypeExports {
  // The request value the validators' `input` entry accepts.
  input: ExportRef;
  output: ExportRef;
  errors: ExportRef;
}

// The one list of link kinds: each kind, its descriptor, and through it its styles. The `client` kind and the
// `class-validator` style wait for the targets that use them.
export interface DescriptorByKind {
  validators: ValidatorsDescriptor;
  types: TypesDescriptor;
}

export type LinkKind = keyof DescriptorByKind;

export type LinkStyle<Kind extends LinkKind = LinkKind> = DescriptorByKind[Kind]["style"];

export type Descriptor = DescriptorByKind[LinkKind];

// What a provider's `describe` returns: one descriptor per kind it provides.
export type ProvidedDescriptors<Provided extends LinkKind> = {
  readonly [Kind in Provided]: DescriptorByKind[Kind];
};

// What the CLI receives from any provider, keyed by kind.
export type DescriptorSet = { readonly [Kind in LinkKind]?: DescriptorByKind[Kind] };
