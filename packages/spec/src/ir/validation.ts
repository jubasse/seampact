import { escapePointer, isSchemaNode, walkSchema } from "./schema-walk.js";
import { IR_SCHEMA_DOCUMENTS, type SchemaNode } from "./schemas.js";

// The known-values annotation of an open enum (README.md): a string member typed `{ type: string,
// "x-seampact-known": [...] }`. It never validates; a reader that acts on the value names an unknown one.
export const KNOWN_VALUES_KEYWORD = "x-seampact-known";

// What a JSON Schema 2020-12 validator needs to read the IR schema files, written for Ajv 8 (`ajv/dist/2020`)
// and kept free of an Ajv import so this package has no runtime dependency: strict mode, every error at once,
// and the `discriminator` keyword of the union idiom.
export const IR_AJV_OPTIONS = { strict: true, allErrors: true, discriminator: true } as const;
export const IR_KEYWORDS = [
  {
    keyword: KNOWN_VALUES_KEYWORD,
    schemaType: "array",
    metaSchema: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true },
  },
] as const;

export type IrSchemaForm = "open" | "strict";

// The strict form for the compiler's own output check (p2-finalize): the published schema files with every
// object shape closed (`additionalProperties: false` beside its `properties`). Computed, never written by hand.
// Union wrappers hold no `properties` and stay as they are: the `discriminator` dispatches to a closed
// variant. Maps keep their value schema and opaque values (`{}`) stay open, since they hold data.
export function strictIrSchemas(
  documents: readonly SchemaNode[] = IR_SCHEMA_DOCUMENTS,
): SchemaNode[] {
  return documents.map((document) => {
    const copy = structuredClone(document) as Record<string, unknown>;
    walkSchema(copy, (node) => {
      if (isSchemaNode(node.properties)) (node as Record<string, unknown>).additionalProperties = false;
    });
    return copy;
  });
}

// The members of a validator error this module reads (Ajv's `ErrorObject` has them).
export interface IrValidatorError {
  instancePath: string;
  keyword: string;
  message?: string;
  params: Record<string, unknown>;
}

export interface IrUnknownKind {
  pointer: string; // the union object
  tag: string; // its tag member: `kind`, or `in`, `verify`, `policy`
  value: string;
}

export interface IrSchemaProblem {
  pointer: string;
  keyword: string;
  message: string;
}

export interface IrValidationReport {
  valid: boolean;
  // A tag outside a union's known variants: accepted by the open form (the reader names it when it acts on
  // it), refused by the strict form.
  unknownKinds: IrUnknownKind[];
  // Pointers of members the strict form does not know.
  unknownMembers: string[];
  problems: IrSchemaProblem[];
}

// Sorts validator errors into unknown kinds, unknown members and other problems, as the given form reads them.
export function classifyIrErrors(
  errors: readonly IrValidatorError[] | null | undefined,
  form: IrSchemaForm,
): IrValidationReport {
  const report: IrValidationReport = {
    valid: true,
    unknownKinds: [],
    unknownMembers: [],
    problems: [],
  };
  for (const error of errors ?? []) {
    const { tag, tagValue, error: discriminatorError, additionalProperty } = error.params;
    if (
      error.keyword === "discriminator" &&
      discriminatorError === "mapping" &&
      typeof tag === "string" &&
      typeof tagValue === "string"
    ) {
      report.unknownKinds.push({ pointer: error.instancePath, tag, value: tagValue });
      if (form === "strict") report.valid = false;
    } else if (error.keyword === "additionalProperties" && typeof additionalProperty === "string") {
      report.unknownMembers.push(`${error.instancePath}/${escapePointer(additionalProperty)}`);
      report.valid = false;
    } else {
      report.problems.push({
        pointer: error.instancePath,
        keyword: error.keyword,
        message: error.message ?? error.keyword,
      });
      report.valid = false;
    }
  }
  return report;
}
