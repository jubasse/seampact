import type { IrWriter, Origin } from "@seampact/spec/ir";
import { type DraftIR, type DraftOperation, pipelineCopy } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import {
  type TreeNodesReportOnce,
  treeNodesError,
  treeNodesNodeOrigin,
  treeNodesReportOnce,
} from "./diagnostics.js";
import {
  type TreeNodesContext,
  type TreeNodesJson,
  treeNodesAnsweredUse,
  treeNodesIsObject,
  treeNodesMember,
  treeNodesOriginAt,
  treeNodesPointer,
  treeNodesSchema,
} from "./raw.js";
import {
  type TreeNodesTemplatePlace,
  treeNodesTemplate,
  treeNodesTemplateSlots,
  treeNodesTemplateUses,
} from "./templates.js";

// The wire formats (ADR 0002 section 13, ADR 0004 section 8): every one declared in `formats`, used or not, and the
// core `bare` (bare payload, RFC 9457 errors) where no layer declares `bare`. A format without `error` takes the
// bare one. The templates each response writes are then checked against the operation's payload.

/** The format every api has: the core one, unless a layer declares its own `bare`. */
export const TREE_NODES_BARE_FORMAT = "bare";
/** The origin of the core `bare` format (ADR 0004 section 6). */
export const TREE_NODES_BARE_ORIGIN: Origin = { layer: "core", pointer: "/formats/bare" };
/** The success media of a format that writes none, and of the core `bare`. */
export const TREE_NODES_DEFAULT_MEDIA = "application/json";

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

// The slots that read the item's id property (ADR 0002 section 13); `$self` too on a collection's item.
const ID_SLOTS: readonly string[] = ["id", "fields", "itemId", "itemFields", "itemSelf"];
const SELF_SLOT = "self";
// The slots that hold the record without its id member.
const IDLESS_SLOTS: readonly string[] = ["fields", "itemFields"];

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

/** Writes `formats`: every declared format, used or not, and `bare`, from the core where no layer declares it. */
export function treeNodesFormats(draft: DraftIR, context: TreeNodesContext): void {
  // A declared `bare` is read first, since a format without `error` takes its error.
  const bare = formatOf(context, TREE_NODES_BARE_FORMAT, BARE_ERROR);
  const bareError = bare?.error;

  if (bare !== undefined) draft.formats[TREE_NODES_BARE_FORMAT] = bare;

  const declared = context.raw.merged.formats;

  for (const id of treeNodesIsObject(declared) ? Object.keys(declared) : []) {
    if (id === TREE_NODES_BARE_FORMAT) continue;

    const format = formatOf(context, id, bareError);

    if (format !== undefined) draft.formats[id] = format;
  }
}

const declaredFormat = (context: TreeNodesContext, id: string): TreeNodesJson | undefined =>
  treeNodesMember(context.raw.merged.formats, id);

function coreBare(): IrWriter.WireFormat {
  return {
    id: TREE_NODES_BARE_FORMAT,
    origin: pipelineCopy(TREE_NODES_BARE_ORIGIN),
    media: TREE_NODES_DEFAULT_MEDIA,
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

  if (declared === undefined || origin === undefined)
    return id === TREE_NODES_BARE_FORMAT ? coreBare() : undefined;

  const reader = new FormatReader(context, id, pointer);
  const media = textOf(treeNodesMember(declared, "media")) ?? TREE_NODES_DEFAULT_MEDIA;
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
  namedTemplates: TreeNodesJson | undefined,
  pointer: string,
): IrWriter.HeaderTemplate[] | undefined {
  if (!treeNodesIsObject(namedTemplates)) return [];

  const templates: IrWriter.HeaderTemplate[] = [];
  let refused = false;

  for (const [name, written] of Object.entries(namedTemplates)) {
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
    return treeNodesAnsweredUse(this.context, `${pointer}/schema`, "output");
  }

  refuseUntypedMeta(name: string, fill: string, pointer: string): undefined {
    this.context.report(
      treeNodesError({
        rule: "format-meta",
        origin: treeNodesNodeOrigin(treeNodesOriginAt(this.context, pointer)),
        message: `The meta field ${quote(name)} of ${this.owner} is filled by ${quote(fill)}, which gives it no type.`,
        fix: `Write the schema of ${quote(name)} beside its fill.`,
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

// ADR 0002 section 13: a slot reading the id needs that property on the item, a merged slot must hold an object
// whose members the template does not write again, and a mapped slot an array. A response is checked against the
// templates it really writes: a page against its style's body, else the format's page.

/** The format or paging style a template belongs to, as messages name it. */
interface TemplateOwner {
  readonly name: string;
  readonly origin: Origin;
}

interface WrittenTemplate {
  readonly template: IrWriter.Template;
  readonly owner: TemplateOwner;
}

/** What a slot holds for one response: an object, an id-keyed table, an array, or another value. */
type SlotValue =
  | { readonly kind: "object"; readonly schema: IrWriter.ObjectSchema }
  | { readonly kind: "table" }
  | { readonly kind: "array"; readonly items: IrWriter.TypeUse }
  | { readonly kind: "other" };

interface PayloadCheck {
  readonly draft: DraftIR;
  readonly once: TreeNodesReportOnce;
  readonly operation: DraftOperation;
  readonly shape: ShapeName;
  readonly payload: SlotValue;
  /** The use of one record: the item, or an element of the list or page. */
  readonly record: IrWriter.TypeUse;
}

/** Checks each success response of each operation against the templates its format and paging style write. */
export function treeNodesCheckPayloads(draft: DraftIR, context: TreeNodesContext): void {
  const once = treeNodesReportOnce((diagnostic) => context.report(diagnostic));

  for (const operation of draft.operations) {
    const format =
      operation.format === undefined ? undefined : ownOf(draft.formats, operation.format);

    if (format === undefined) continue;

    for (const response of operation.responses ?? []) {
      if (response.body === undefined || !isSuccessShape(response.shape)) continue;

      const check: PayloadCheck = {
        draft,
        once,
        operation,
        shape: response.shape,
        payload: payloadOf(draft, response.shape, response.body),
        record: recordOf(response.shape, response.body),
      };

      for (const written of writtenTemplates(draft, operation, format, response.shape)) {
        checkIdSlots(check, written);
        checkSlotValues(check, written, written.template, undefined);
      }
    }
  }
}

const ownOf = <Value>(catalogue: Readonly<Record<string, Value>>, id: string): Value | undefined =>
  Object.hasOwn(catalogue, id) ? catalogue[id] : undefined;

const isSuccessShape = (shape: IrWriter.ResponseShape): shape is ShapeName =>
  SHAPES.some((name) => name === shape);

function slotValueOfUse(draft: DraftIR, use: IrWriter.TypeUse): SlotValue {
  if (use.kind === "array") return { kind: "array", items: use.items };

  const schema = use.kind === "ref" ? treeNodesSchema(draft, use.schema) : undefined;

  if (schema?.kind === "object") return { kind: "object", schema };

  return schema?.kind === "map" ? { kind: "table" } : { kind: "other" };
}

// `$payload` is the item, the id-keyed table, or the records of a list or page.
function payloadOf(draft: DraftIR, shape: ShapeName, body: IrWriter.TypeUse): SlotValue {
  if (shape === "item") return slotValueOfUse(draft, body);

  if (shape === "table") return { kind: "table" };

  return { kind: "array", items: recordOf(shape, body) };
}

const recordOf = (shape: ShapeName, body: IrWriter.TypeUse): IrWriter.TypeUse =>
  (shape === "list" || shape === "page") && body.kind === "array" ? body.items : body;

function writtenTemplates(
  draft: DraftIR,
  operation: DraftOperation,
  format: IrWriter.WireFormat,
  shape: ShapeName,
): WrittenTemplate[] {
  const formatOwner: TemplateOwner = { name: `the format ${format.id}`, origin: format.origin };
  const { body, headers } = format.success[shape];
  const formatHeaders = headers.map(({ value }) => ({ template: value, owner: formatOwner }));
  const styleId = operation.paging?.style;
  const style =
    shape === "page" && styleId !== undefined ? ownOf(draft.pagings, styleId) : undefined;

  if (style === undefined) return [{ template: body, owner: formatOwner }, ...formatHeaders];

  const styleOwner: TemplateOwner = { name: `the paging style ${style.id}`, origin: style.origin };
  const { response } = style;

  return [
    response.body === undefined
      ? { template: body, owner: formatOwner }
      : { template: response.body, owner: styleOwner },
    ...formatHeaders,
    ...[...response.meta, ...response.headers].map(({ value }) => ({
      template: value,
      owner: styleOwner,
    })),
  ];
}

function checkIdSlots(check: PayloadCheck, written: WrittenTemplate): void {
  const { draft, operation, shape, record } = check;
  const idSlots =
    shape === "item" && isCollectionItem(operation) ? [...ID_SLOTS, SELF_SLOT] : ID_SLOTS;
  const used = treeNodesTemplateSlots(written.template).find(({ slot }) => idSlots.includes(slot));

  if (used === undefined) return;

  const property = operation.resource?.idProperty ?? operation.resource?.idParam;
  const item = slotValueOfUse(draft, record);

  if (property !== undefined && item.kind === "object" && hasProperty(item.schema, property))
    return;

  reportPayload(check, written.owner, {
    rule: "format-id",
    message: `The template of ${written.owner.name} writes $${used.slot}, but the item of ${operation.id} has no id property${property === undefined ? "" : ` ${quote(property)}`}.`,
    fix: `Declare ${property === undefined ? "the id property" : quote(property)} on the item (or set idProperty), or use a format that reads no id.`,
  });
}

// `$self` is a collection item's member URL, built from its id; elsewhere it is the request URL.
const isCollectionItem = (operation: DraftOperation): boolean =>
  operation.resource?.idProperty !== undefined || operation.resource?.idParam !== undefined;

const hasProperty = (schema: IrWriter.ObjectSchema, name: string): boolean =>
  schema.properties.some((property) => property.name === name);

// Walks a template with the element `$item` holds inside `$as`.
function checkSlotValues(
  check: PayloadCheck,
  written: WrittenTemplate,
  template: IrWriter.Template,
  element: SlotValue | undefined,
): void {
  switch (template.kind) {
    case "object":
      if (template.merge !== undefined)
        checkMerge(check, written, template, template.merge, element);

      for (const member of template.members) checkSlotValues(check, written, member.value, element);

      return;
    case "array":
      for (const item of template.items) checkSlotValues(check, written, item, element);

      return;
    case "each":
      checkSlotValues(check, written, template.as, eachElement(check, written, template, element));

      return;
    default:
      return;
  }
}

// The value a slot holds for this response; undefined for an object slot the payload does not set (`$meta`).
function slotValue(
  check: PayloadCheck,
  slot: string,
  element: SlotValue | undefined,
): SlotValue | undefined {
  switch (slot) {
    case "payload":
      return check.payload;
    case "items":
      return { kind: "array", items: check.record };
    case "fields":
      return slotValueOfUse(check.draft, check.record);
    case "item":
    case "itemFields":
      return element;
    default:
      return undefined;
  }
}

function eachElement(
  check: PayloadCheck,
  written: WrittenTemplate,
  template: IrWriter.EachTemplate,
  element: SlotValue | undefined,
): SlotValue | undefined {
  const mapped = slotValue(check, template.of, element);

  if (mapped === undefined) return undefined;

  if (mapped.kind === "array") return slotValueOfUse(check.draft, mapped.items);

  reportPayload(check, written.owner, {
    rule: "format-each",
    message: `The template of ${written.owner.name} maps $${template.of} with $each, but it holds no array for ${check.operation.id}.`,
    fix: `Write $${template.of} as a member, or use a format whose ${check.shape} shape maps no $${template.of}.`,
  });

  return undefined;
}

// A table's id-keyed payload is an object whose members are ids, so no member clash is checked.
function checkMerge(
  check: PayloadCheck,
  written: WrittenTemplate,
  template: IrWriter.ObjectTemplate,
  merge: string,
  element: SlotValue | undefined,
): void {
  const merged = slotValue(check, merge, element);
  const { operation } = check;
  const owner = written.owner;

  if (merged === undefined || merged.kind === "table") return;

  if (merged.kind !== "object") {
    reportPayload(check, owner, {
      rule: "format-merge",
      message: `The template of ${owner.name} merges $${merge}, but it holds ${merged.kind === "array" ? "an array" : "no object"} for ${operation.id}.`,
      fix: `Answer an object from ${operation.id}, map an array with { $each: $${merge}, $as: <template> }, or use a format that wraps the payload.`,
    });

    return;
  }

  const idProperty = IDLESS_SLOTS.includes(merge)
    ? (operation.resource?.idProperty ?? operation.resource?.idParam)
    : undefined;
  const memberNames = template.members.flatMap((member) =>
    member.name.kind === "text" ? [member.name.text] : [],
  );
  const twice = merged.schema.properties.find(
    ({ name }) => name !== idProperty && memberNames.includes(name),
  );

  if (twice !== undefined)
    reportPayload(check, owner, {
      rule: "format-merge",
      message: `The template of ${owner.name} writes the member ${quote(twice.name)}, which the merged $${merge} of ${operation.id} defines too.`,
      fix: `Rename the property ${quote(twice.name)} of ${merged.schema.id}, or the template's member.`,
    });
}

interface PayloadFault {
  readonly rule: "format-id" | "format-merge" | "format-each";
  readonly message: string;
  readonly fix: string;
}

// Two success responses of one operation may share a fault: it is reported once.
function reportPayload(check: PayloadCheck, owner: TemplateOwner, fault: PayloadFault): void {
  const { operation } = check;

  check.once(
    JSON.stringify([fault.rule, operation.id, fault.message]),
    treeNodesError({
      ...fault,
      origin: treeNodesNodeOrigin(originOfOperation(operation)),
      related:
        owner.origin.layer === "core"
          ? []
          : [{ origin: treeNodesNodeOrigin(owner.origin), message: owner.name }],
    }),
  );
}

function originOfOperation(operation: DraftOperation): Origin {
  if (operation.origin === undefined)
    throw new Error(`the operation ${operation.id} has no origin`);

  return operation.origin;
}
