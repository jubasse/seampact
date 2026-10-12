import {
  type IrUnknownKind,
  type IrUnknownValue,
  KNOWN_VALUES_KEYWORD,
  listIrUnknowns,
  MUST_ACT_KEYWORD,
} from "./instance-walk.js";
import { escapePointer, isSchemaNode, walkSchema } from "./schema-walk.js";
import {
  IR_SCHEMA_DOCUMENTS,
  IR_SCHEMA_ID,
  type SchemaNode,
  SOURCE_MAP_SCHEMA_ID,
} from "./schemas.js";

export { KNOWN_VALUES_KEYWORD, MUST_ACT_KEYWORD };
export type { IrUnknownKind, IrUnknownValue };

// What a JSON Schema 2020-12 validator needs to read the IR schema files, written for Ajv 8 (`ajv/dist/2020`)
// and kept free of an Ajv import so this package has no runtime dependency: strict mode, the `discriminator`
// keyword of the union idiom, and every error at once. `allErrors` is load-bearing: an unknown union tag is an
// expected discriminator error in the open form, and a validator that stops at the first error would hide
// every real problem after it (README.md). `createIrValidator` always uses these options.
export const IR_AJV_OPTIONS = { strict: true, allErrors: true, discriminator: true } as const;

export interface IrKeywordDefinition {
  keyword: string;
  schemaType: "array" | "boolean";
  metaSchema: Record<string, unknown>;
}

// The annotation keywords of the IR schema files, to register with the validator. Neither validates.
export const IR_KEYWORDS: readonly IrKeywordDefinition[] = [
  {
    keyword: KNOWN_VALUES_KEYWORD,
    schemaType: "array",
    metaSchema: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true },
  },
  {
    keyword: MUST_ACT_KEYWORD,
    schemaType: "boolean",
    metaSchema: { type: "boolean", const: true },
  },
];

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
      if (isSchemaNode(node.properties))
        (node as Record<string, unknown>).additionalProperties = false;
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

export interface IrSchemaProblem {
  pointer: string;
  keyword: string;
  message: string;
}

export interface IrValidationReport {
  // Open form: no problem and no must-act unknown. Strict form: no problem and nothing unknown.
  valid: boolean;
  // Tags outside a union's known variants: accepted by the open form unless must-act (a reader names one
  // when it acts on it), refused by the strict form.
  unknownKinds: IrUnknownKind[];
  // Values outside an open enum's known values: the same rule.
  unknownValues: IrUnknownValue[];
  // Pointers of members the strict form does not know.
  unknownMembers: string[];
  problems: IrSchemaProblem[];
}

const isMappingError = (error: IrValidatorError): boolean =>
  error.keyword === "discriminator" &&
  error.params.error === "mapping" &&
  typeof error.params.tag === "string" &&
  typeof error.params.tagValue === "string";

// Sorts validator errors and an instance's unknowns into one report, as the given form reads them. The
// unknowns come from `listIrUnknowns`, complete whatever the validator reported; a discriminator mapping
// error is the validator's view of an unknown tag and is filtered out (kept only if the walk missed it).
export function classifyIrErrors(
  errors: readonly IrValidatorError[] | null | undefined,
  form: IrSchemaForm,
  unknowns: { kinds: readonly IrUnknownKind[]; values: readonly IrUnknownValue[] } = {
    kinds: [],
    values: [],
  },
): IrValidationReport {
  const report: IrValidationReport = {
    valid: true,
    unknownKinds: [...unknowns.kinds],
    unknownValues: [...unknowns.values],
    unknownMembers: [],
    problems: [],
  };
  for (const error of errors ?? []) {
    const { tag, tagValue, additionalProperty } = error.params;
    if (isMappingError(error)) {
      if (!report.unknownKinds.some((kind) => kind.pointer === error.instancePath))
        report.unknownKinds.push({
          pointer: error.instancePath,
          tag: String(tag),
          value: String(tagValue),
          mustAct: false,
        });
    } else if (error.keyword === "additionalProperties" && typeof additionalProperty === "string") {
      report.unknownMembers.push(`${error.instancePath}/${escapePointer(additionalProperty)}`);
    } else {
      report.problems.push({
        pointer: error.instancePath,
        keyword: error.keyword,
        message: error.message ?? error.keyword,
      });
    }
  }
  const unknown = [...report.unknownKinds, ...report.unknownValues];
  report.valid =
    report.problems.length === 0 &&
    report.unknownMembers.length === 0 &&
    (form === "strict" ? unknown.length === 0 : unknown.every((item) => !item.mustAct));
  return report;
}

// The parts of an Ajv 2020 instance `createIrValidator` uses, so this package needs no Ajv import.
export interface IrAjvValidateFunction {
  (data: unknown): unknown;
  errors?: readonly IrValidatorError[] | null;
}
export interface IrAjv {
  addKeyword(definition: IrKeywordDefinition): unknown;
  addSchema(schema: SchemaNode): unknown;
  getSchema(id: string): IrAjvValidateFunction | undefined;
}
export type IrAjvConstructor = new (options: typeof IR_AJV_OPTIONS) => IrAjv;

export interface IrValidator {
  // An IR document: schema problems, unknown members (strict form), unknown kinds and values.
  validate(value: unknown): IrValidationReport;
  validateSourceMap(value: unknown): IrValidationReport;
}

// Wires a validator for one form: `createIrValidator(Ajv2020, "strict")`, `Ajv2020` from `ajv/dist/2020.js`.
// The caller supplies the constructor, so `@seampact/spec` keeps no runtime dependency. The options are always
// `IR_AJV_OPTIONS`. A reader of a third-party bundle caps the input size before validating (README.md).
export function createIrValidator(Ajv: IrAjvConstructor, form: IrSchemaForm): IrValidator {
  const ajv = new Ajv({ ...IR_AJV_OPTIONS });
  for (const keyword of IR_KEYWORDS) ajv.addKeyword(structuredClone(keyword));
  const documents = form === "open" ? IR_SCHEMA_DOCUMENTS : strictIrSchemas();
  for (const document of documents) ajv.addSchema(structuredClone(document));
  const compiled = (id: string): IrAjvValidateFunction => {
    const validate = ajv.getSchema(id);
    if (validate === undefined) throw new Error(`no schema ${id}`);
    return validate;
  };
  const ir = compiled(IR_SCHEMA_ID);
  const sourceMap = compiled(SOURCE_MAP_SCHEMA_ID);
  return {
    validate(value) {
      ir(value);
      return classifyIrErrors(ir.errors, form, listIrUnknowns(value));
    },
    validateSourceMap(value) {
      sourceMap(value);
      return classifyIrErrors(sourceMap.errors, form);
    },
  };
}
