import {
  classifyIrErrors,
  IR_AJV_OPTIONS,
  IR_KEYWORDS,
  IR_SCHEMA_ID,
  type IrValidationReport,
  listIrUnknowns,
  type SchemaNode,
  strictIrSchemas,
} from "@seampact/spec/ir";
import { Ajv2020 } from "ajv/dist/2020.js";

// The derived draft form (ADR 0006 section 2): the strict IR schema with every `required` removed, so a draft that
// holds only what the halves run so far wrote validates, while every member it holds keeps its strict shape (no
// unknown member, union tag or open-enum value). Computed from `strictIrSchemas()`, never written by hand.
//
// One `required` stays: a union variant keeps its tag. The `discriminator` reads the tag to pick the variant, and
// Ajv refuses a discriminator whose tag is optional; a half writes a union element whole, tag included.

type SchemaObject = Record<string, unknown>;

const isSchemaObject = (value: unknown): value is SchemaObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Every object of a schema document, nested ones included.
function forEachSchemaObject(value: unknown, visit: (node: SchemaObject) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) forEachSchemaObject(item, visit);

    return;
  }

  if (!isSchemaObject(value)) return;
  visit(value);

  for (const member of Object.values(value)) forEachSchemaObject(member, visit);
}

const definitionName = (ref: string): string => ref.slice(ref.lastIndexOf("/") + 1);

// The tag of each union variant, by definition name (unique across the IR schema files, `schemas/ir/README.md`).
function variantTags(documents: readonly SchemaObject[]): Map<string, string> {
  const tags = new Map<string, string>();

  for (const document of documents)
    forEachSchemaObject(document, (node) => {
      const discriminator = node.discriminator;

      if (!isSchemaObject(discriminator) || typeof discriminator.propertyName !== "string") return;

      if (!Array.isArray(node.oneOf)) return;

      for (const variant of node.oneOf)
        if (isSchemaObject(variant) && typeof variant.$ref === "string")
          tags.set(definitionName(variant.$ref), discriminator.propertyName);
    });

  return tags;
}

/** The IR schema documents in the derived draft form. */
export function draftIrSchemas(): SchemaNode[] {
  // `strictIrSchemas()` clones each document deeply; the shallow copy only types it as writable.
  const documents: SchemaObject[] = strictIrSchemas().map((document) => ({ ...document }));
  const tags = variantTags(documents);

  for (const document of documents) {
    forEachSchemaObject(document, (node) => {
      if (Array.isArray(node.required)) delete node.required;
    });

    const definitions = document.$defs;

    if (!isSchemaObject(definitions)) continue;

    for (const [name, definition] of Object.entries(definitions)) {
      const tag = tags.get(name);

      if (tag !== undefined && isSchemaObject(definition)) definition.required = [tag];
    }
  }

  return documents;
}

export interface DraftValidator {
  /** A draft read as the strict form reads an IR, with no member required (a union tag aside). */
  validate(draft: unknown): IrValidationReport;
}

/** A validator of the derived draft form, for the draft fixtures and the pass lanes' tests. */
export function createDraftValidator(): DraftValidator {
  const ajv = new Ajv2020({ ...IR_AJV_OPTIONS });

  for (const keyword of IR_KEYWORDS) ajv.addKeyword(structuredClone(keyword));

  for (const document of draftIrSchemas()) ajv.addSchema(document);

  const validateIr = ajv.getSchema(IR_SCHEMA_ID);

  if (validateIr === undefined) throw new Error(`the draft form has no schema ${IR_SCHEMA_ID}`);

  return {
    validate(draft) {
      validateIr(draft);

      return classifyIrErrors(validateIr.errors, "strict", listIrUnknowns(draft));
    },
  };
}
