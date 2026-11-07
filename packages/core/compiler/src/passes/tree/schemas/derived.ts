import type { IrWriter } from "@seampact/spec/ir";
import {
  type TreeSchemasRaw,
  type TreeSchemasRawObject,
  type TreeSchemasReporter,
  treeSchemasEntries,
  treeSchemasIsObject,
  treeSchemasMember,
  treeSchemasPointer,
} from "./raw.js";
import { treeSchemasDocs } from "./scalars.js";

// Derived objects (ADR 0003 section 2): `pick` and `omit` merged into the properties of a plain object. A kept
// property keeps its schema, refinements, marks, docs and origin; `required` replaces the source's list; an overlay
// replaces the members it sets on one kept property.

/** What the merge asks of the schema compiler. */
export interface TreeSchemasDerivedHost {
  readonly reporter: TreeSchemasReporter;
  /** A copy of the properties of the object schema `name`, or undefined once a problem is reported. */
  sourceProperties(name: string, pointer: string): IrWriter.Property[] | undefined;
  restriction(written: TreeSchemasRaw | undefined, pointer: string): IrWriter.FieldRestriction;
  /** A copy of the examples written on `value`, each queued to be parsed against `use`; undefined when none. */
  examples(value: TreeSchemasRaw, pointer: string, use: IrWriter.TypeUse): unknown[] | undefined;
  /** A copy of the default written on `value`, queued to be parsed against `use`; undefined when none. */
  defaultValue(value: TreeSchemasRaw, pointer: string, use: IrWriter.TypeUse): unknown;
}

type DerivedKind = "pick" | "omit";

const writtenStrings = (value: TreeSchemasRaw | undefined): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

/** The properties of a `pick` or `omit` schema, or undefined once a problem is reported. */
export function treeSchemasDerivedProperties(
  value: TreeSchemasRawObject,
  pointer: string,
  host: TreeSchemasDerivedHost,
): IrWriter.Property[] | undefined {
  // validate refuses `pick` beside `omit`.
  const kind: DerivedKind = Object.hasOwn(value, "pick") ? "pick" : "omit";
  const spec = treeSchemasMember(value, kind);
  const from = treeSchemasMember(spec, "from");

  if (typeof from !== "string")
    throw new Error(
      `tree.schemas found no '${kind}.from' at ${pointer}, which validate guarantees`,
    );
  const source = host.sourceProperties(from, treeSchemasPointer(pointer, kind, "from"));

  if (source === undefined) return undefined;

  const kept = keptProperties(
    kind,
    from,
    source,
    writtenStrings(treeSchemasMember(spec, "fields")),
    {
      pointer: treeSchemasPointer(pointer, kind, "fields"),
      reporter: host.reporter,
    },
  );

  if (kept === undefined) return undefined;

  if (!applyRequired(value, kept, pointer, host.reporter)) return undefined;

  return applyOverlays(value, kept, pointer, host) ? kept : undefined;
}

function keptProperties(
  kind: DerivedKind,
  from: string,
  source: IrWriter.Property[],
  fields: readonly string[],
  { pointer, reporter }: { pointer: string; reporter: TreeSchemasReporter },
): IrWriter.Property[] | undefined {
  let failed = false;

  for (const [index, field] of fields.entries()) {
    const repeated = fields.indexOf(field) !== index;

    if (!repeated && source.some((property) => property.name === field)) continue;
    failed = true;
    reporter.error({
      rule: "derived-field",
      pointer: treeSchemasPointer(pointer, String(index)),
      message: repeated
        ? `the field '${field}' is listed twice`
        : `'${field}' is no property of the source '${from}'`,
      fix: repeated
        ? "list each field once"
        : `remove it from 'fields', or declare it on '${from}'`,
    });
  }

  if (failed) return undefined;

  if (kind === "omit") return source.filter((property) => !fields.includes(property.name));

  return fields.flatMap((field) => source.filter((property) => property.name === field));
}

// `required` replaces the source's list for the kept properties; without it each keeps its own.
function applyRequired(
  value: TreeSchemasRawObject,
  kept: IrWriter.Property[],
  pointer: string,
  reporter: TreeSchemasReporter,
): boolean {
  if (!Object.hasOwn(value, "required")) return true;
  const required = writtenStrings(value.required);
  const unknown = required.filter((name) => !kept.some((property) => property.name === name));

  for (const name of unknown) {
    reporter.error({
      rule: "required-unknown",
      pointer: treeSchemasPointer(pointer, "required"),
      message: `'${name}' is required but is no property the derived object keeps`,
      fix: "keep the property, or remove it from 'required'",
    });
  }

  for (const property of kept) property.optional = !required.includes(property.name);

  return unknown.length === 0;
}

function applyOverlays(
  value: TreeSchemasRawObject,
  kept: IrWriter.Property[],
  pointer: string,
  host: TreeSchemasDerivedHost,
): boolean {
  let failed = false;

  for (const [name, overlay] of treeSchemasEntries(value.properties)) {
    const at = treeSchemasPointer(pointer, "properties", name);
    const property = kept.find((candidate) => candidate.name === name);

    if (property === undefined) {
      failed = true;
      host.reporter.error({
        rule: "derived-overlay",
        pointer: at,
        message: `'${name}' is not a property the derived object keeps, so it cannot be overlaid`,
        fix: "overlay a kept property; write a new or different field in full in an 'allOf' beside the derived object",
      });
      continue;
    }

    failed = !overlayProperty(property, overlay, at, host) || failed;
  }

  return !failed;
}

// The members an overlay sets replace the source's (the authoring schema admits no other key).
function overlayProperty(
  property: IrWriter.Property,
  overlay: TreeSchemasRaw,
  pointer: string,
  host: TreeSchemasDerivedHost,
): boolean {
  if (!treeSchemasIsObject(overlay)) return true;

  if (typeof overlay.nullable === "boolean") property.nullable = overlay.nullable;

  if (typeof overlay.deprecated === "boolean") property.deprecated = overlay.deprecated;

  if (Object.hasOwn(overlay, "restrictedTo"))
    property.restrictedTo = host.restriction(overlay.restrictedTo, pointer);
  property.docs = { ...property.docs, ...treeSchemasDocs(overlay) };
  const use = structuredClone(property.type);

  if (property.nullable) use.nullable = true;
  const examples = host.examples(overlay, pointer, use);

  if (examples !== undefined) property.examples = examples;
  const defaulted = host.defaultValue(overlay, pointer, use);

  if (defaulted !== undefined) property.default = defaulted;

  return checkRequiredOverlay(property, overlay, pointer, host.reporter);
}

// A restricted or defaulted property is optional by nature, as on a written property (ADR 0003 sections 6, 10).
function checkRequiredOverlay(
  property: IrWriter.Property,
  overlay: TreeSchemasRawObject,
  pointer: string,
  reporter: TreeSchemasReporter,
): boolean {
  if (property.optional) return true;
  const reasons = [
    ...(Object.hasOwn(overlay, "restrictedTo")
      ? ["a restricted property is optional by nature"]
      : []),
    ...(Object.hasOwn(overlay, "default") ? ["a default fills an absent property"] : []),
  ];

  for (const reason of reasons) {
    reporter.error({
      rule: "required-property",
      pointer,
      message: `'${property.name}' stays required, but ${reason}`,
      fix: "leave it out of 'required'",
    });
  }

  return reasons.length === 0;
}
