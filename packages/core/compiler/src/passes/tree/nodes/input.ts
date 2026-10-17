import type { IrWriter, Origin } from "@seampact/spec/ir";
import type { DiagnosticOrigin } from "../../../diagnostics/diagnostic.js";
import {
  type DraftIR,
  type DraftOperationInput,
  pipelineCopy,
  type TreeNode,
} from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesLocate, treeNodesNodeOrigin } from "./diagnostics.js";
import { treeNodesFieldWireOf, treeNodesIsFileField } from "./field-wire.js";
import { treeNodesBodyLimit } from "./limits.js";
import { type TreeNodesContext, treeNodesPointer, treeNodesSchema } from "./raw.js";

// The request body a route declares (ADR 0002 section 7, "Bodies beyond JSON"): its media, its type use from the
// schema service, its origin, and for a form or multipart body the wire of each field. Files travel only as a
// top-level multipart field (or as a download, a response), each within the route's body limit.

type Media = IrWriter.InputMediaType;

const JSON_MEDIA: Media = "application/json";
const FORM_MEDIA: Media = "application/x-www-form-urlencoded";
const MULTIPART_MEDIA: Media = "multipart/form-data";

// `inputMedia` as written, and the media type it names.
const MEDIA_OF_INPUT_MEDIA = new Map<string, Media>([
  ["json", JSON_MEDIA],
  ["form", FORM_MEDIA],
  ["multipart", MULTIPART_MEDIA],
]);

const MEDIA_WORD = new Map<Media, string>([
  [JSON_MEDIA, "JSON"],
  [FORM_MEDIA, "form"],
  [MULTIPART_MEDIA, "multipart"],
]);

/** One operation's input, read from its node. */
interface InputSite {
  readonly node: TreeNode;
  readonly operationId: string;
  readonly origin: DiagnosticOrigin;
  readonly media: Media;
  readonly draft: DraftIR;
  readonly context: TreeNodesContext;
}

/** A file reached from an input use, below its top level. */
interface NestedFile {
  readonly path: string;
  readonly origin: Origin | undefined;
}

/**
 * The input a route or an op entry declares (`input`), or undefined when it declares none or the schema service
 * answers no use for it. The schema is the input use the service answers for the written schema; reads `schemas`
 * for the fields of a form or multipart body.
 */
export function treeNodesInput(
  node: TreeNode,
  operationId: string,
  draft: DraftIR,
  context: TreeNodesContext,
): DraftOperationInput | undefined {
  if (!Object.hasOwn(node.settings, "input")) return undefined;

  const pointer = `${node.pointer}/input`;
  const origin = context.origin(pointer);

  if (origin === undefined)
    throw new Error(`the raw tree has no origin for the input at ${pointer}`);

  // The service answers every input tree.schemas accepted, and a refused one stops the run before this half
  // (the stop rule). It answers none only while tree.schemas is the seam's stub, which knows no schema.
  const schema = context.treeSchemas.typeUse(pointer, "input");

  if (schema === undefined) return undefined;

  const media = mediaOf(node);
  const site: InputSite = {
    node,
    operationId,
    origin: treeNodesNodeOrigin(origin),
    media,
    draft,
    context,
  };

  if (media === JSON_MEDIA) {
    reportNestedFiles(site, filesBelow(schema, draft, undefined), undefined);

    return { media, schema: pipelineCopy(schema), origin: pipelineCopy(origin) };
  }

  const fields = formFields(site, schema);
  const input = { media, schema: pipelineCopy(schema), origin: pipelineCopy(origin) };

  return fields === undefined ? input : { ...input, fields };
}

function mediaOf(node: TreeNode): Media {
  const written = Object.hasOwn(node.settings, "inputMedia") ? node.settings.inputMedia : undefined;

  if (written === undefined) return JSON_MEDIA;
  const media = typeof written === "string" ? MEDIA_OF_INPUT_MEDIA.get(written) : undefined;

  if (media === undefined)
    throw new Error(`inputMedia at ${node.pointer} is no media the grammar admits`);

  return media;
}

const mediaWord = (media: Media): string => MEDIA_WORD.get(media) ?? media;

// The fields of a form or multipart input: each property of its object schema, with its wire. Undefined, with a
// diagnostic, when the input is no object schema.
function formFields(site: InputSite, schema: IrWriter.TypeUse): IrWriter.InputField[] | undefined {
  const declared = schema.kind === "ref" ? treeNodesSchema(site.draft, schema.schema) : undefined;

  if (declared?.kind !== "object") {
    site.context.report(
      treeNodesError({
        rule: "form-input",
        origin: site.origin,
        message: `The ${mediaWord(site.media)} input of ${site.operationId} is not an object schema, so it has no fields.`,
        fix: "Declare the input as an object whose properties are the fields.",
      }),
    );

    return undefined;
  }

  const schemaPointer = inputSchemaPointer(site.node, declared.id);
  const fields: IrWriter.InputField[] = [];

  for (const property of declared.properties) {
    const fieldPointer = treeNodesPointer(schemaPointer, "properties", property.name);
    const wire = fieldWire(site, property, fieldPointer);

    if (wire !== undefined) fields.push({ name: property.name, wire });
  }

  return fields;
}

// Where the input schema sits, which keys the wire of each of its fields: the declared schema it names, or the
// route's own inline input. A field is asked at its position there, not at its origin, which for a derived field
// (`expectedVersion`) or one from another layer is elsewhere.
function inputSchemaPointer(node: TreeNode, schemaId: string): string {
  const written = Object.hasOwn(node.settings, "input") ? node.settings.input : undefined;

  return typeof written === "string"
    ? treeNodesPointer("/schemas", schemaId)
    : `${node.pointer}/input`;
}

function fieldWire(
  site: InputSite,
  property: IrWriter.Property,
  fieldPointer: string,
): IrWriter.FieldWire | undefined {
  const at = treeNodesLocate(property.origin, site.origin);

  if (treeNodesIsFileField(property.type)) {
    checkFileField(site, property, at);
  } else {
    const nestedFiles = filesBelow(property.type, site.draft, property.origin);

    reportNestedFiles(site, nestedFiles, property.name);

    if (nestedFiles.length > 0) return undefined;
  }

  const wire =
    property.type.kind === "opaque"
      ? undefined
      : treeNodesFieldWireOf(fieldPointer, property.type, site.context.treeSchemas);

  if (wire === undefined)
    site.context.report(
      treeNodesError({
        rule: "form-field",
        origin: at,
        message: `The field ${property.name} of the ${mediaWord(site.media)} input of ${site.operationId} has no form encoding.`,
        fix: "Give the field a number, boolean, text, list or object schema, a file in multipart, or JSON text (contentMediaType: application/json).",
      }),
    );

  return wire;
}

// A file field: only in multipart, each file within the route's body limit.
function checkFileField(site: InputSite, property: IrWriter.Property, at: DiagnosticOrigin): void {
  if (site.media !== MULTIPART_MEDIA) {
    site.context.report(
      treeNodesError({
        rule: "input-file",
        origin: at,
        message: `The form input of ${site.operationId} holds the file field ${property.name}, but a form body carries no file.`,
        fix: "Set inputMedia: multipart, which carries files.",
      }),
    );

    return;
  }

  const file = property.type.kind === "array" ? property.type.items : property.type;
  const maxSize = file.kind === "file" ? file.maxSizeBytes : undefined;
  const limit = treeNodesBodyLimit(site.node, site.context);

  if (maxSize === undefined || limit === undefined || maxSize <= limit.bytes) return;

  site.context.report(
    treeNodesError({
      rule: "input-file-size",
      origin: at,
      message: `The file field ${property.name} of ${site.operationId} allows ${maxSize} bytes, more than the route's body limit of ${limit.bytes} bytes.`,
      fix: "Raise bodyLimit on the route, or lower the file's maxSize.",
      related:
        limit.origin === undefined
          ? []
          : [{ origin: treeNodesLocate(limit.origin, site.origin), message: "the body limit" }],
    }),
  );
}

// Every file reached from `use` (a file itself included), through schemas, items, map values, union variants and
// the schema of a JSON text field; each at its path below `use`, located at the nearest property, else `useOrigin`.
function filesBelow(
  use: IrWriter.TypeUse,
  draft: DraftIR,
  useOrigin: Origin | undefined,
): NestedFile[] {
  const found: NestedFile[] = [];
  const visited = new Set<string>();

  const visit = (at: IrWriter.TypeUse, atPath: string, origin: Origin | undefined): void => {
    if (at.kind === "file") found.push({ path: atPath, origin });
    else if (at.kind === "array") visit(at.items, atPath, origin);
    else if (at.kind === "ref") visitSchema(at.schema, atPath);
    else if (at.kind === "scalar" && at.content !== undefined)
      visit(at.content.schema, atPath, origin);
  };

  const visitSchema = (id: string, atPath: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const schema = treeNodesSchema(draft, id);

    if (schema === undefined) return;

    if (schema.kind === "object")
      for (const property of schema.properties)
        visit(property.type, joinPath(atPath, property.name), property.origin);
    else if (schema.kind === "map") visit(schema.values, atPath, schema.origin);
    else
      for (const variant of schema.variants)
        visitSchema(variant.schema, joinPath(atPath, variant.tag));
  };

  visit(use, "", useOrigin);

  return found;
}

const joinPath = (path: string, member: string): string =>
  path === "" ? member : `${path}.${member}`;

// A file reached below the top level of an input: a JSON body carries none, a form or multipart field neither.
function reportNestedFiles(
  site: InputSite,
  files: readonly NestedFile[],
  field: string | undefined,
): void {
  for (const file of files) {
    const at = file.path === "" ? "" : ` at ${file.path}`;
    const message =
      field === undefined
        ? `The JSON input of ${site.operationId} holds a file${at === "" ? " as its whole body" : at}, but a file travels only in a multipart input or as a download.`
        : `The ${mediaWord(site.media)} input of ${site.operationId} holds a file${at} inside the field ${field}, but a file is a top-level field.`;

    site.context.report(
      treeNodesError({
        rule: "input-file",
        origin: file.origin === undefined ? site.origin : treeNodesLocate(file.origin, site.origin),
        message,
        fix: "Make the file a top-level field of a multipart input (inputMedia: multipart), or return it as a download.",
      }),
    );
  }
}
