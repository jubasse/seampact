import type { IrWriter, Origin } from "@seampact/spec/ir";
import { type DraftIR, type DraftOperation, pipelineCopy } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import {
  type TreeNodesContext,
  type TreeNodesJson,
  treeNodesIsObject,
  treeNodesMember,
  treeNodesObjectOf,
  treeNodesOriginAt,
  treeNodesPointer,
} from "./raw.js";
import {
  type TreeNodesTemplatePlace,
  treeNodesTemplate,
  treeNodesTemplateSlots,
  treeNodesTemplateUses,
} from "./templates.js";

// The wire formats the operations use (ADR 0002 section 13, ADR 0004 section 8): each declared one read from
// `formats`, and the core `bare` (bare payload, RFC 9457 errors) where no layer declares `bare`. A format without
// `error` takes the bare one. Each format's shapes are then checked against the payload of every operation using it.

const BARE = "bare";
const BARE_ORIGIN: Origin = { layer: "core", pointer: "/formats/bare" };
const DEFAULT_MEDIA = "application/json";
const BARE_ERROR_MEDIA = "application/problem+json";
const NULL_ABSENT: IrWriter.Absent = "null";
const DEFAULT_ABSENT: IrWriter.Absent = "omit";

type ShapeName = keyof IrWriter.SuccessShapes;

const SHAPES: readonly ShapeName[] = ["item", "table", "list", "page"];

// A shape left out writes the payload (the page's records for `page`) and no header.
const DEFAULT_BODY_SLOT: Readonly<Record<ShapeName, string>> = {
  item: "payload",
  table: "payload",
  list: "payload",
  page: "items",
};

const META_TYPES: Readonly<Record<string, IrWriter.TypeUse>> = {
  now: { kind: "scalar", type: "string", format: "date-time", refinements: {} },
  traceId: { kind: "scalar", type: "string", refinements: {} },
  degraded: { kind: "scalar", type: "boolean", refinements: {} },
};
const HANDLER_FILL = "handler";
const PRINCIPAL_PREFIX = "principal.";

// The slots that read the item's id property (ADR 0002 section 13).
const ID_SLOTS: readonly string[] = ["id", "fields", "itemId", "itemFields", "itemSelf"];
// The slots a merge spreads the payload's members from.
const PAYLOAD_SLOTS: readonly string[] = ["payload", "fields"];

const slot = (name: string): IrWriter.Template => ({ kind: "slot", slot: name, path: [] });

const bareErrorMember = (name: string, slotName = name): IrWriter.ObjectTemplateMember => ({
  name: { kind: "text", text: name },
  value: slot(slotName),
});

// ADR 0006 section 7: the RFC 9457 members of the bare error, its params spread beside them.
const BARE_ERROR: IrWriter.ErrorShape = {
  media: BARE_ERROR_MEDIA,
  body: {
    kind: "object",
    members: [
      bareErrorMember("type", "code"),
      bareErrorMember("title"),
      bareErrorMember("status"),
      bareErrorMember("detail"),
      bareErrorMember("instance"),
      bareErrorMember("code"),
      bareErrorMember("nature"),
      bareErrorMember("traceId"),
    ],
    merge: "params",
  },
  headers: [],
};

/** Writes `formats`: every format an operation uses, `bare` from the core where no layer declares it. */
export function treeNodesFormats(draft: DraftIR, context: TreeNodesContext): void {
  const used = new Set(draft.operations.flatMap((operation) => operation.format ?? []));

  // A declared `bare` is read first, since a format without `error` takes its error.
  const bare = formatOf(context, BARE, BARE_ERROR);
  const bareError = bare?.error;

  if (bare !== undefined && used.has(BARE)) draft.formats[BARE] = bare;

  for (const id of used) {
    if (id === BARE) continue;

    const format = formatOf(context, id, bareError);

    if (format !== undefined) draft.formats[id] = format;
  }

  for (const operation of draft.operations) checkPayloads(draft, context, operation);
}

const declaredFormat = (context: TreeNodesContext, id: string): TreeNodesJson | undefined =>
  treeNodesMember(context.raw.merged.formats, id);

function coreBare(): IrWriter.WireFormat {
  return {
    id: BARE,
    origin: pipelineCopy(BARE_ORIGIN),
    media: DEFAULT_MEDIA,
    absent: DEFAULT_ABSENT,
    success: {
      item: { body: slot("payload"), headers: [] },
      table: { body: slot("payload"), headers: [] },
      list: { body: slot("payload"), headers: [] },
      page: { body: slot("items"), headers: [] },
    },
    meta: {},
    error: pipelineCopy(BARE_ERROR),
  };
}

/** Reads a declared format; undefined when it is refused (reported) or declared nowhere (`format-unknown`). */
function formatOf(
  context: TreeNodesContext,
  id: string,
  bareError: IrWriter.ErrorShape | undefined,
): IrWriter.WireFormat | undefined {
  const declared = declaredFormat(context, id);
  const pointer = treeNodesPointer("/formats", id);
  const origin = context.origin(pointer);

  if (declared === undefined || origin === undefined) return id === BARE ? coreBare() : undefined;

  const reader = new FormatReader(context, id, pointer);
  const media = textOf(treeNodesMember(declared, "media")) ?? DEFAULT_MEDIA;
  const success = reader.success(treeNodesMember(declared, "success"));
  const meta = reader.meta(treeNodesMember(declared, "meta"));
  const error = reader.error(treeNodesMember(declared, "error"), media, bareError);

  if (success === undefined || meta === undefined || error === undefined) return undefined;

  return {
    id,
    origin: pipelineCopy(origin),
    media,
    absent: treeNodesAbsent(treeNodesMember(declared, "absent")),
    success,
    meta,
    error,
  };
}

/** What a slot with no value writes: `null` when `absent` is written null, else omitted. */
export const treeNodesAbsent = (written: TreeNodesJson | undefined): IrWriter.Absent =>
  written === null ? NULL_ABSENT : DEFAULT_ABSENT;

const textOf = (value: TreeNodesJson | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

/** The templates of a mapping (`headers`, a style's `meta`), each named as written; undefined when one is refused. */
export function treeNodesNamedTemplates(
  context: TreeNodesContext,
  owner: string,
  place: TreeNodesTemplatePlace,
  headers: TreeNodesJson | undefined,
  pointer: string,
): IrWriter.HeaderTemplate[] | undefined {
  if (!treeNodesIsObject(headers)) return [];

  const templates: IrWriter.HeaderTemplate[] = [];
  let refused = false;

  for (const [name, written] of Object.entries(headers)) {
    const value = treeNodesTemplate(
      { context, place, owner },
      written,
      treeNodesPointer(pointer, name),
    );

    if (value === undefined) refused = true;
    else templates.push({ name, value });
  }

  return refused ? undefined : templates;
}

class FormatReader {
  readonly owner: string;

  constructor(
    readonly context: TreeNodesContext,
    readonly id: string,
    readonly pointer: string,
  ) {
    this.owner = `the format ${id}`;
  }

  success(written: TreeNodesJson | undefined): IrWriter.SuccessShapes | undefined {
    const shapes: Partial<Record<ShapeName, IrWriter.Shape>> = {};
    let refused = false;

    for (const name of SHAPES) {
      const shape = this.shape(name, treeNodesMember(written, name));

      if (shape === undefined) refused = true;
      else shapes[name] = shape;
    }

    const { item, table, list, page } = shapes;

    return refused ||
      item === undefined ||
      table === undefined ||
      list === undefined ||
      page === undefined
      ? undefined
      : { item, table, list, page };
  }

  shape(name: ShapeName, written: TreeNodesJson | undefined): IrWriter.Shape | undefined {
    const pointer = treeNodesPointer(this.pointer, "success", name);
    const writtenBody = treeNodesMember(written, "body");
    const body =
      writtenBody === undefined
        ? slot(DEFAULT_BODY_SLOT[name])
        : treeNodesTemplate(this.site(name), writtenBody, `${pointer}/body`);
    const headers = treeNodesNamedTemplates(
      this.context,
      this.owner,
      name,
      treeNodesMember(written, "headers"),
      `${pointer}/headers`,
    );

    return body === undefined || headers === undefined ? undefined : { body, headers };
  }

  meta(written: TreeNodesJson | undefined): Record<string, IrWriter.MetaMember> | undefined {
    const members: Record<string, IrWriter.MetaMember> = {};
    let refused = false;

    if (!treeNodesIsObject(written)) return members;

    for (const [name, field] of Object.entries(written)) {
      const member = this.metaMember(name, field);

      if (member === undefined) refused = true;
      else members[name] = member;
    }

    return refused ? undefined : members;
  }

  // `now`, `traceId` and `degraded` have a core type; `handler` and a principal field take the written `schema`.
  metaMember(name: string, field: TreeNodesJson): IrWriter.MetaMember | undefined {
    const pointer = treeNodesPointer(this.pointer, "meta", name);
    const fill = textOf(treeNodesMember(field, "fill"));

    if (fill === undefined) throw new Error(`the meta field at ${pointer} has no fill`);

    const type =
      treeNodesMember(field, "schema") === undefined ? META_TYPES[fill] : this.schemaType(pointer);

    if (type === undefined) return this.refuseUntypedMeta(name, fill, pointer);

    if (!fill.startsWith(PRINCIPAL_PREFIX))
      return { type: pipelineCopy(type), fill: fill === HANDLER_FILL ? "handler" : metaFill(fill) };

    return {
      type: pipelineCopy(type),
      fill: "source",
      source: { in: "principal", name: fill.slice(PRINCIPAL_PREFIX.length) },
    };
  }

  schemaType(pointer: string): IrWriter.TypeUse {
    const type = this.context.treeSchemas.typeUse(`${pointer}/schema`, "output");

    if (type === undefined)
      throw new Error(`tree.schemas answers no type for the meta schema at ${pointer}/schema`);

    return type;
  }

  refuseUntypedMeta(name: string, fill: string, pointer: string): undefined {
    this.context.report(
      treeNodesError({
        rule: "format-meta",
        origin: treeNodesNodeOrigin(treeNodesOriginAt(this.context, pointer)),
        message: `The meta field ${name} of ${this.owner} is filled by ${fill}, which gives it no type.`,
        fix: `Write the schema of ${name} beside its fill.`,
      }),
    );

    return undefined;
  }

  // A format without `error` takes the bare one; its `media` defaults to the format's, and it must write `$code`.
  error(
    written: TreeNodesJson | undefined,
    media: string,
    bareError: IrWriter.ErrorShape | undefined,
  ): IrWriter.ErrorShape | undefined {
    if (written === undefined) return bareError === undefined ? undefined : pipelineCopy(bareError);

    const pointer = treeNodesPointer(this.pointer, "error");
    const writtenBody = treeNodesMember(written, "body");
    const body =
      writtenBody === undefined
        ? undefined
        : treeNodesTemplate(this.site("error"), writtenBody, `${pointer}/body`);
    const headers = treeNodesNamedTemplates(
      this.context,
      this.owner,
      "error",
      treeNodesMember(written, "headers"),
      `${pointer}/headers`,
    );

    if (writtenBody !== undefined && body === undefined) return undefined;

    if (body === undefined || !treeNodesTemplateUses(body, "code"))
      return this.refuseCodeless(pointer);

    return headers === undefined
      ? undefined
      : { media: textOf(treeNodesMember(written, "media")) ?? media, body, headers };
  }

  refuseCodeless(pointer: string): undefined {
    this.context.report(
      treeNodesError({
        rule: "format-error-code",
        origin: treeNodesNodeOrigin(treeNodesOriginAt(this.context, pointer)),
        message: `The error body of ${this.owner} writes no $code, so a client cannot tell the error.`,
        fix: `Write $code in the error body, as a member or inside a text ('https://errors.example.com/\${code}').`,
      }),
    );

    return undefined;
  }

  site(place: TreeNodesTemplatePlace) {
    return { context: this.context, place, owner: this.owner };
  }
}

const METAFILLS: readonly IrWriter.MetaFill[] = ["now", "traceId", "degraded"];

function metaFill(fill: string): IrWriter.MetaFill {
  const known = METAFILLS.find((candidate) => candidate === fill);

  if (known === undefined)
    throw new Error(`the meta fill ${fill} is none of ${METAFILLS.join(", ")}`);

  return known;
}

// ADR 0002 section 13: a slot reading the id needs that property on the item, and a merged payload must be an
// object whose members the template does not write again.
function checkPayloads(draft: DraftIR, context: TreeNodesContext, operation: DraftOperation): void {
  const id = operation.format;
  const format =
    id !== undefined && Object.hasOwn(draft.formats, id) ? draft.formats[id] : undefined;

  if (format === undefined) return;

  for (const response of operation.responses ?? []) {
    if (response.body === undefined || !isSuccessShape(response.shape)) continue;

    const shape = format.success[response.shape];
    const templates = [shape.body, ...shape.headers.map((header) => header.value)];
    const item = treeNodesObjectOf(draft, itemUse(response.body));

    checkIdSlots(context, operation, format, templates, item);

    if (response.shape === "item") checkMerges(context, operation, format, shape.body, item);
  }
}

const isSuccessShape = (shape: IrWriter.ResponseShape): shape is ShapeName =>
  SHAPES.some((name) => name === shape);

const itemUse = (body: IrWriter.TypeUse): IrWriter.TypeUse =>
  body.kind === "array" ? body.items : body;

function checkIdSlots(
  context: TreeNodesContext,
  operation: DraftOperation,
  format: IrWriter.WireFormat,
  templates: readonly IrWriter.Template[],
  item: IrWriter.ObjectSchema | undefined,
): void {
  const used = templates
    .flatMap(treeNodesTemplateSlots)
    .find(({ slot }) => ID_SLOTS.includes(slot));

  if (used === undefined) return;

  const property = operation.resource?.idProperty ?? operation.resource?.idParam;

  if (property !== undefined && item?.properties.some(({ name }) => name === property)) return;

  reportPayload(context, operation, format, {
    rule: "format-id",
    message: `The format ${format.id} writes $${used.slot}, but the item of ${operation.id} has no id property${property === undefined ? "" : ` ${property}`}.`,
    fix: `Declare ${property ?? "the id property"} on the item (or set idProperty), or use a format that reads no id.`,
  });
}

function checkMerges(
  context: TreeNodesContext,
  operation: DraftOperation,
  format: IrWriter.WireFormat,
  body: IrWriter.Template,
  item: IrWriter.ObjectSchema | undefined,
): void {
  for (const merging of mergingObjects(body)) {
    if (item === undefined) {
      reportPayload(context, operation, format, {
        rule: "format-merge",
        message: `The format ${format.id} merges $${merging.merge}, but the payload of ${operation.id} is no object.`,
        fix: `Answer an object from ${operation.id}, or use a format that wraps the payload.`,
      });
      continue;
    }

    const written = merging.members.flatMap((member) =>
      member.name.kind === "text" ? [member.name.text] : [],
    );
    const twice = item.properties.find(({ name }) => written.includes(name));

    if (twice !== undefined)
      reportPayload(context, operation, format, {
        rule: "format-merge",
        message: `The format ${format.id} writes the member ${twice.name}, which the merged payload of ${operation.id} defines too.`,
        fix: `Rename the property ${twice.name} of ${item.id}, or the format's member.`,
      });
  }
}

type MergingObject = IrWriter.ObjectTemplate & { readonly merge: string };

function mergingObjects(template: IrWriter.Template): MergingObject[] {
  switch (template.kind) {
    case "object": {
      const inner = template.members.flatMap((member) => mergingObjects(member.value));
      const { merge } = template;

      return merge !== undefined && PAYLOAD_SLOTS.includes(merge)
        ? [{ ...template, merge }, ...inner]
        : inner;
    }
    case "array":
      return template.items.flatMap(mergingObjects);
    case "each":
      return mergingObjects(template.as);
    default:
      return [];
  }
}

interface PayloadFault {
  readonly rule: "format-id" | "format-merge";
  readonly message: string;
  readonly fix: string;
}

function reportPayload(
  context: TreeNodesContext,
  operation: DraftOperation,
  format: IrWriter.WireFormat,
  fault: PayloadFault,
): void {
  context.report(
    treeNodesError({
      ...fault,
      origin: treeNodesNodeOrigin(originOfOperation(operation)),
      related:
        format.origin.layer === "core"
          ? []
          : [{ origin: treeNodesNodeOrigin(format.origin), message: `the format ${format.id}` }],
    }),
  );
}

function originOfOperation(operation: DraftOperation): Origin {
  if (operation.origin === undefined)
    throw new Error(`the operation ${operation.id} has no origin`);

  return operation.origin;
}
