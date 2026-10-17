import type { IrWriter, Origin } from "@seampact/spec/ir";
import { pipelineCopy, type TreeNode } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesLocate, treeNodesNodeOrigin } from "./diagnostics.js";
import {
  type TreeNodesField,
  type TreeNodesSite,
  treeNodesFields,
  treeNodesFieldTravels,
} from "./fields.js";
import {
  TREE_NODES_BATCH_OP,
  TREE_NODES_DELETE_OP,
  TREE_NODES_LIST_OP,
  treeNodesOpOwner,
  treeNodesOpShorthand,
} from "./names.js";
import {
  type TreeNodesJson,
  treeNodesIsObject,
  treeNodesMember,
  treeNodesPointer,
  treeNodesSetting,
} from "./raw.js";

// The success and redirect responses a route declares (ADR 0002 sections 6, 7 and 10), sorted by status: its
// `responses`, else its `output` (the op's status, or 200), else its `item` (a list), else the op's default from the
// `ops` table. A list is a page unless `paging: none`; a file body is a download (`binary`), a redirect status has
// no body; any other body travels in the operation's format, with the format's media type. A route that declares
// none answers 204 with no body. The batch op's table response is derived (`batch.read`).

const DEFAULT_STATUS = 200;
const NO_CONTENT = 204;
const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];
const DEFAULT_MEDIA = "application/json";

/** `paging: none`: a list served whole. */
export const TREE_NODES_PAGING_NONE = "none";

type Op = IrWriter.OpShorthand;

// The ops whose default response is the owner's `item`.
const ITEM_OPS: readonly Op[] = ["get", "create", "update"];

// ADR 0006 section 5: a download and a redirect bypass the format.
const BYPASSING_SHAPES: readonly IrWriter.ResponseShape[] = ["binary", "redirect"];
const FORMAT_DERIVATION: IrWriter.DerivationId = "response.format";
const BATCH_DERIVATION: IrWriter.DerivationId = "batch.read";

// ADR 0004 section 6: the core `bare` format, where no layer declares one.
const CORE_FORMAT = "bare";
const CORE_FORMAT_ORIGIN: Origin = { layer: "core", pointer: "/formats/bare" };

const RESPONSES_INSTEAD_OF: readonly string[] = ["output", "item"];

// The response annotations the IR cannot hold yet (`Response.docs` is asked of the lead IR PR).
const UNHELD_RESPONSE_ANNOTATIONS: readonly string[] = ["description"];

/** The wire format of an operation: the nearest `format`, else `conventions.format`. */
export function treeNodesFormat(site: TreeNodesSite): string {
  const nearest = site.context.inherited(site.node, "format")?.entry.value;
  const format = nearest ?? site.context.conventions.get("format")?.value;

  if (typeof format !== "string")
    throw new Error(`the operation ${site.operationId} resolves no format`);

  return format;
}

// A format's success media: as its declaration writes it, else JSON, which the core `bare` format uses.
function mediaOf(site: TreeNodesSite, format: string): string {
  const declared = treeNodesMember(site.context.raw.merged.formats, format);
  const media = treeNodesMember(declared, "media");

  return typeof media === "string" ? media : DEFAULT_MEDIA;
}

/**
 * The responses a route declares, sorted by status. Each response but a download or a redirect records that its
 * shape travels in the operation's format (`response.format`, ADR 0006 section 5), from the format's declaration.
 */
export function treeNodesResponses(site: TreeNodesSite, format: string): IrWriter.Response[] {
  const node = site.node;
  const media = mediaOf(site, format);
  const op = treeNodesOpShorthand(node);

  const responses = declaredResponses(site, op, media);

  for (const response of responses) checkNoContentBody(site, response);

  const formatOrigin = formatOriginOf(site, format);

  if (formatOrigin === undefined) return responses;

  return responses.map((response) =>
    response.derivedFrom !== undefined || BYPASSING_SHAPES.includes(response.shape)
      ? response
      : {
          ...response,
          derivedFrom: { derivation: FORMAT_DERIVATION, from: [pipelineCopy(formatOrigin)] },
        },
  );
}

/** Whether a route is a list: the list op, or a route that sets `item` instead of `output` (ADR 0002 section 10). */
export function treeNodesIsList(node: TreeNode): boolean {
  const op = treeNodesOpShorthand(node);

  if (op !== undefined) return op === TREE_NODES_LIST_OP;

  return (
    treeNodesSetting(node, "responses") === undefined &&
    treeNodesSetting(node, "output") === undefined &&
    treeNodesSetting(node, "item") !== undefined
  );
}

// A declared format's origin, else the core `bare`'s; a format declared nowhere is refused where it is named.
function formatOriginOf(site: TreeNodesSite, format: string): Origin | undefined {
  const declared = site.context.origin(treeNodesPointer("/formats", format));

  if (declared !== undefined) return declared;

  if (format === CORE_FORMAT) return CORE_FORMAT_ORIGIN;

  const named =
    site.context.inherited(site.node, "format")?.entry.origin ??
    site.context.conventions.get("format")?.origin;

  if (named === undefined)
    throw new Error(`the format ${format} of ${site.operationId} is named nowhere`);

  site.once(
    `format-unknown:${named.layer}#${named.pointer}`,
    treeNodesError({
      rule: "format-unknown",
      origin: treeNodesNodeOrigin(named),
      message: `The format ${format} of ${site.operationId} is not declared in formats.`,
      fix: `Declare ${format} in formats (a format pack provides some), or name a declared format.`,
    }),
  );

  return undefined;
}

function declaredResponses(
  site: TreeNodesSite,
  op: Op | undefined,
  media: string,
): IrWriter.Response[] {
  const node = site.node;
  const written = treeNodesSetting(node, "responses");

  if (treeNodesIsObject(written)) {
    checkResponsesAlone(site);

    return Object.keys(written)
      .flatMap((status) => writtenResponse(site, status, media) ?? [])
      .sort((a, b) => a.status - b.status);
  }

  if (treeNodesSetting(node, "output") !== undefined)
    return bodyResponse(site, node, "output", outputStatus(site, op), "item", media);

  if (op === undefined && treeNodesSetting(node, "item") !== undefined)
    return bodyResponse(site, node, "item", DEFAULT_STATUS, listShape(node), media);

  if (op === undefined) return [emptyResponse(NO_CONTENT, node.origin)];

  return opResponses(site, op, media);
}

// ADR 0002 section 7: `responses` is written instead of `output` (and of a list's `item`), never beside them.
function checkResponsesAlone(site: TreeNodesSite): void {
  const beside = RESPONSES_INSTEAD_OF.filter(
    (member) => treeNodesSetting(site.node, member) !== undefined,
  );

  for (const member of beside) {
    const pointer = `${site.node.pointer}/${member}`;

    site.context.report(
      treeNodesError({
        rule: "responses-output",
        origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? site.node.origin),
        message: `The route ${site.operationId} writes both responses and ${member}; responses replaces ${member}.`,
        fix: `Move the ${member} schema into a responses entry, or remove responses.`,
      }),
    );
  }
}

// 204 No Content carries no body (RFC 9110 section 15.3.5).
function checkNoContentBody(site: TreeNodesSite, response: IrWriter.Response): void {
  if (response.status !== NO_CONTENT || response.body === undefined) return;
  site.context.report(
    treeNodesError({
      rule: "no-content-body",
      origin: treeNodesNodeOrigin(response.origin ?? site.node.origin),
      message: `The 204 response of ${site.operationId} has a body, which a 204 No Content never carries.`,
      fix: "Answer the body with 200, or remove the body.",
    }),
  );
}

// The `ops` table's default response: the op's own `item`, else the owner's, for list, get, create and update; no
// body for delete.
function opResponses(site: TreeNodesSite, op: Op, media: string): IrWriter.Response[] {
  const status = opStatus(site, op);

  if (op === TREE_NODES_DELETE_OP) return [emptyResponse(status, site.node.origin)];

  const owner = treeNodesOpOwner(site.node);
  const isList = op === TREE_NODES_LIST_OP;

  if (owner === undefined || (!isList && op !== TREE_NODES_BATCH_OP && !ITEM_OPS.includes(op)))
    throw new Error(`the op at ${site.node.pointer} has no owner or no default response`);

  const itemWriter = treeNodesSetting(site.node, "item") === undefined ? owner : site.node;

  if (treeNodesSetting(itemWriter, "item") === undefined) {
    reportNoItem(site, owner, op);

    return [];
  }

  if (op === TREE_NODES_BATCH_OP) return batchTable(site, itemWriter, status, media);

  const shape = isList ? listShape(site.node) : "item";

  return bodyResponse(site, itemWriter, "item", status, shape, media);
}

// ADR 0002 section 6 and ADR 0006 section 5 (`batch.read`): the id-keyed table of the owner's items.
function batchTable(
  site: TreeNodesSite,
  itemWriter: TreeNode,
  status: number,
  media: string,
): IrWriter.Response[] {
  const body = site.context.treeSchemas.typeUse(`${itemWriter.pointer}/item`, "output");

  if (body === undefined) return [];

  return [
    {
      status,
      media,
      body: pipelineCopy(body),
      shape: "table",
      headers: [],
      derivedFrom: { derivation: BATCH_DERIVATION, from: [pipelineCopy(site.node.origin)] },
    },
  ];
}

function opStatus(site: TreeNodesSite, op: Op): number {
  const status = site.context.conventions.get(`ops.${op}.status`)?.value;

  if (typeof status !== "number")
    throw new Error(`conventions.ops.${op}.status resolves to no status`);

  return status;
}

// `output` takes the op's status, or 200; a delete with a body answers 200 (SCN-040).
function outputStatus(site: TreeNodesSite, op: Op | undefined): number {
  if (op === undefined) return DEFAULT_STATUS;
  const status = opStatus(site, op);

  return op === TREE_NODES_DELETE_OP && status === NO_CONTENT ? DEFAULT_STATUS : status;
}

const listShape = (node: TreeNode): IrWriter.ResponseShape =>
  treeNodesSetting(node, "paging") === TREE_NODES_PAGING_NONE ? "list" : "page";

function emptyResponse(status: number, origin: Origin): IrWriter.Response {
  return { status, shape: "empty", headers: [], origin: pipelineCopy(origin) };
}

// A response whose body is written at `<owner>/<member>` (`output` or `item`).
function bodyResponse(
  site: TreeNodesSite,
  owner: TreeNode,
  member: "output" | "item",
  status: number,
  shape: IrWriter.ResponseShape,
  media: string,
): IrWriter.Response[] {
  const pointer = `${owner.pointer}/${member}`;
  const origin = site.context.origin(pointer) ?? owner.origin;
  const body = site.context.treeSchemas.typeUse(pointer, "output");

  if (body === undefined) return [];

  return [
    {
      status,
      ...(body.kind === "file" ? {} : { media }),
      body: pipelineCopy(body),
      shape: body.kind === "file" ? "binary" : shape,
      headers: [],
      origin: pipelineCopy(origin),
    },
  ];
}

// One entry of `responses`: its body and headers; a redirect status with no body. Undefined while the schema
// service answers no type for a written body (the seam's stub; an internal error from PR 4).
function writtenResponse(
  site: TreeNodesSite,
  statusKey: string,
  media: string,
): IrWriter.Response | undefined {
  const pointer = `${site.node.pointer}/responses/${statusKey}`;
  const entry = treeNodesMember(treeNodesSetting(site.node, "responses"), statusKey);
  const origin = site.context.origin(pointer) ?? site.node.origin;
  const status = Number(statusKey);

  refuseUnheldAnnotations(site, entry, pointer, status);
  const headers = responseHeaders(site, treeNodesMember(entry, "headers"), `${pointer}/headers`);

  const writtenBody = treeNodesMember(entry, "body");

  if (REDIRECT_STATUSES.includes(status)) {
    if (writtenBody !== undefined) reportRedirectBody(site, status, `${pointer}/body`);

    return { status, shape: "redirect", headers, origin: pipelineCopy(origin) };
  }

  if (writtenBody === undefined)
    return { status, shape: "empty", headers, origin: pipelineCopy(origin) };

  const body = site.context.treeSchemas.typeUse(`${pointer}/body`, "output");

  if (body === undefined) return undefined;

  const isFile = body.kind === "file";

  return {
    status,
    ...(isFile ? {} : { media }),
    body: pipelineCopy(body),
    shape: isFile ? "binary" : "item",
    headers,
    origin: pipelineCopy(origin),
  };
}

// A written annotation the IR has no member for is refused, never dropped.
function refuseUnheldAnnotations(
  site: TreeNodesSite,
  entry: TreeNodesJson | undefined,
  pointer: string,
  status: number,
): void {
  for (const key of UNHELD_RESPONSE_ANNOTATIONS.filter(
    (annotation) => treeNodesMember(entry, annotation) !== undefined,
  )) {
    const at = `${pointer}/${key}`;

    site.context.report(
      treeNodesError({
        rule: "annotation-position",
        origin: treeNodesNodeOrigin(site.context.origin(at) ?? site.node.origin),
        message: `The ${key} of the ${status} response of ${site.operationId} is not kept by the contract model.`,
        fix: `Remove ${key} here; describe the response in the route's description.`,
      }),
    );
  }
}

// Each header name once, in any case (RFC 9110 section 5.1).
function responseHeaders(
  site: TreeNodesSite,
  written: TreeNodesJson | undefined,
  pointer: string,
): IrWriter.ResponseHeader[] {
  const headers: IrWriter.ResponseHeader[] = [];
  const seen = new Map<string, TreeNodesField>();

  for (const field of treeNodesFields(site, written, pointer, "output").fields) {
    const name = field.name.toLowerCase();
    const first = seen.get(name);

    if (first !== undefined) {
      reportHeaderTwice(site, field, first);
      continue;
    }

    seen.set(name, field);

    if (field.type === undefined || !treeNodesFieldTravels(site, field, "response header"))
      continue;
    headers.push({
      name: field.name,
      type: pipelineCopy(field.type),
      required: field.required,
      origin: pipelineCopy(field.origin),
    });
  }

  return headers;
}

function reportHeaderTwice(
  site: TreeNodesSite,
  field: TreeNodesField,
  first: TreeNodesField,
): void {
  const fallback = treeNodesNodeOrigin(site.node.origin);
  const origin = treeNodesLocate(field.origin, fallback);

  site.once(
    `param-unique:${origin.layer}#${origin.pointer}:${field.name}`,
    treeNodesError({
      rule: "param-unique",
      origin,
      message: `The response header ${field.name} of ${site.operationId} is declared twice.`,
      fix: "Remove one of the two declarations.",
      related: [
        { origin: treeNodesLocate(first.origin, fallback), message: "the first declaration" },
      ],
    }),
  );
}

function reportRedirectBody(site: TreeNodesSite, status: number, bodyPointer: string): void {
  site.context.report(
    treeNodesError({
      rule: "redirect-body",
      origin: treeNodesNodeOrigin(site.context.origin(bodyPointer) ?? site.node.origin),
      message: `The ${status} response of ${site.operationId} is a redirect, which has no body.`,
      fix: "Remove the body; the compiler adds the Location header.",
    }),
  );
}

function reportNoItem(site: TreeNodesSite, owner: TreeNode, op: Op): void {
  site.once(
    `op-item:${owner.pointer}:${op}`,
    treeNodesError({
      rule: "op-item",
      origin: treeNodesNodeOrigin(site.node.origin),
      message: `The ${op} op of ${owner.name} answers its item, but ${owner.name} declares no item.`,
      fix: `Declare item on ${owner.name}, or give the op an output.`,
    }),
  );
}
