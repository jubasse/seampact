import { readdirSync, readFileSync } from "node:fs";
import type { ContractIR } from "@seampact/spec/ir";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { EXTENSION_NAMES, type ExtensionName } from "./extension-names.js";
import { isJsonObject, type JsonValue } from "./json-value.js";

// Test support: the committed golden documents and IRs, the OAS 3.1 schema validator and the extension schemas.

const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);
const GOLDEN_DIRECTORY = new URL("fixtures/golden/", REPOSITORY_ROOT);
const VENDOR_DIRECTORY = new URL("../vendor/oas-3.1/", import.meta.url);
const EXTENSIONS_DIRECTORY = new URL("../schemas/extensions/", import.meta.url);
const DIALECT_ID = "https://spec.openapis.org/oas/3.1/dialect/base";
const OPENAPI_DIRECTORY = "openapi";

export interface GoldenDocument {
  /** `<case>/openapi/<file>`. */
  path: string;
  text: string;
  document: JsonValue;
}

export function goldenDocuments(): GoldenDocument[] {
  return readdirSync(GOLDEN_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const directory = new URL(`${entry.name}/${OPENAPI_DIRECTORY}/`, GOLDEN_DIRECTORY);

      return readdirSync(directory).map((file) => {
        const text = readFileSync(new URL(file, directory), "utf8");

        return { path: `${entry.name}/${OPENAPI_DIRECTORY}/${file}`, text, document: parse(text) };
      });
    })
    .sort((left, right) => (left.path < right.path ? -1 : 1));
}

export function goldenDocument(path: string): GoldenDocument {
  const found = goldenDocuments().find((document) => document.path === path);

  if (found === undefined) throw new Error(`no golden document ${path}`);

  return found;
}

/** The golden IR files, as `<case>/<api>`. */
export function goldenIrNames(): string[] {
  return readdirSync(GOLDEN_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(new URL(`${entry.name}/`, GOLDEN_DIRECTORY))
        .filter((file) => file.endsWith(".ir.json"))
        .map((file) => `${entry.name}/${file.slice(0, -".ir.json".length)}`),
    )
    .sort();
}

export function readGoldenIr(name: string): ContractIR {
  return JSON.parse(readFileSync(new URL(`${name}.ir.json`, GOLDEN_DIRECTORY), "utf8"));
}

function readJson(url: URL): Record<string, unknown> {
  return JSON.parse(readFileSync(url, "utf8"));
}

// Ajv resolves `$dynamicAnchor` only at a schema root, while the OAS schema declares it in `$defs/schema`.
// `schema-base` points that anchor at the base dialect, so each `$dynamicRef: '#meta'` reads the dialect directly.
function withDialectReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withDialectReferences);

  if (typeof value !== "object" || value === null) return value;

  if ("$dynamicRef" in value && value.$dynamicRef === "#meta") return { $ref: DIALECT_ID };

  return Object.fromEntries(
    Object.entries(value).map(([member, memberValue]) => [
      member,
      withDialectReferences(memberValue),
    ]),
  );
}

/** Validates a document against the vendored OAS 3.1 `schema-base` (2022-10-07). */
export function createOasValidator(): (document: unknown) => string[] {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

  ajv.addSchema(readJson(new URL("meta-base.json", VENDOR_DIRECTORY)));
  ajv.addSchema(readJson(new URL("dialect-base.json", VENDOR_DIRECTORY)));
  const oasSchema = readJson(new URL("schema.json", VENDOR_DIRECTORY));

  ajv.addSchema(
    Object.fromEntries(
      Object.entries(oasSchema).map(([member, value]) => [member, withDialectReferences(value)]),
    ),
  );

  const validate = ajv.compile(readJson(new URL("schema-base.json", VENDOR_DIRECTORY)));

  return (document) =>
    validate(document)
      ? []
      : (validate.errors ?? []).map(
          (error) => `${error.instancePath} ${error.message ?? error.keyword}`,
        );
}

/** One validator per extension, from the schemas the package publishes. */
export function createExtensionValidators(): Map<ExtensionName, (value: unknown) => string[]> {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validators = new Map<ExtensionName, (value: unknown) => string[]>();

  for (const name of EXTENSION_NAMES) {
    const validate = ajv.compile(readJson(new URL(`${name}.schema.json`, EXTENSIONS_DIRECTORY)));

    validators.set(name, (value) =>
      validate(value)
        ? []
        : (validate.errors ?? []).map(
            (error) => `${error.instancePath} ${error.message ?? error.keyword}`,
          ),
    );
  }

  return validators;
}

/** A member name as a JSON Pointer token (RFC 6901). */
export function pointerToken(member: string): string {
  return member.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** The schema files the package publishes under `schemas/extensions`. */
export function extensionSchemaFiles(): string[] {
  return readdirSync(EXTENSIONS_DIRECTORY).sort();
}

/** Every `x-<key>` member of a document, with its JSON Pointer. */
export function extensionMembers(
  value: unknown,
  pointer = "",
): { key: string; value: unknown; pointer: string }[] {
  if (Array.isArray(value))
    return value.flatMap((item, index) => extensionMembers(item, `${pointer}/${index}`));

  if (!isJsonObject(value)) return [];

  return Object.entries(value).flatMap(([member, memberValue]) => {
    const memberPointer = `${pointer}/${pointerToken(member)}`;
    const own = member.startsWith("x-")
      ? [{ key: member, value: memberValue, pointer: memberPointer }]
      : [];

    return [...own, ...extensionMembers(memberValue, memberPointer)];
  });
}
