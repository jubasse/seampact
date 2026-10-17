import type { IrWriter, Origin } from "@seampact/spec/ir";
import { pipelineCopy, type TreeNode } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import {
  type TreeNodesSite,
  treeNodesFields,
  treeNodesFieldTravels,
  treeNodesHeaderUnionError,
  treeNodesInnermost,
} from "./fields.js";
import { treeNodesOpOwner, treeNodesOpShorthand } from "./names.js";
import { treeNodesIsObject, treeNodesMember, treeNodesSetting, treeNodesTagHeader } from "./raw.js";

// The success and redirect responses a route declares (ADR 0002 sections 6, 7 and 10), sorted by status: its
// `responses`, else its `output` (the op's status, or 200), else its `item` (a list), else the op's default from the
// `ops` table. A list is a page unless `paging: none`; a file body is a download (`binary`), a redirect status has
// no body; any other body travels in the operation's format, with the format's media type. A route that declares
// none answers 204 with no body. The batch op's table response is derived (`batch.read`).

const DEFAULT_STATUS = 200;
const NO_CONTENT = 204;
const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];
const DEFAULT_MEDIA = "application/json";
const PAGING_NONE = "none";

type Op = IrWriter.OpShorthand;

// The ops whose default response is the owner's `item`.
const ITEM_OPS: readonly Op[] = ["get", "create", "update"];
const LIST_OP: Op = "list";
const DELETE_OP: Op = "delete";
const BATCH_OP: Op = "batch";

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

/** The responses a route declares, sorted by status. */
export function treeNodesResponses(site: TreeNodesSite, format: string): IrWriter.Response[] {
  const node = site.node;
  const media = mediaOf(site, format);
  const op = treeNodesOpShorthand(node);

  const written = treeNodesSetting(node, "responses");
  if (treeNodesIsObject(written))
    return Object.keys(written)
      .map((status) => writtenResponse(site, status, media))
      .sort((a, b) => a.status - b.status);

  if (treeNodesSetting(node, "output") !== undefined)
    return bodyResponse(site, node, "output", outputStatus(site, op), "item", media);
  if (op === undefined && treeNodesSetting(node, "item") !== undefined)
    return bodyResponse(site, node, "item", DEFAULT_STATUS, listShape(node), media);

  if (op === undefined) return [emptyResponse(NO_CONTENT, node.origin)];
  return opResponses(site, op, media);
}

// The `ops` table's default response: the op's own `item`, else the owner's, for list, get, create and update; no
// body for delete.
function opResponses(site: TreeNodesSite, op: Op, media: string): IrWriter.Response[] {
  if (op === BATCH_OP) return [];

  const status = opStatus(site, op);
  if (op === DELETE_OP) return [emptyResponse(status, site.node.origin)];

  const owner = treeNodesOpOwner(site.node);
  const isList = op === LIST_OP;
  if (owner === undefined || (!isList && !ITEM_OPS.includes(op)))
    throw new Error(`the op at ${site.node.pointer} has no owner or no default response`);

  const itemWriter = treeNodesSetting(site.node, "item") === undefined ? owner : site.node;
  if (treeNodesSetting(itemWriter, "item") === undefined) {
    reportNoItem(site, owner, op);
    return [];
  }
  const shape = isList ? listShape(site.node) : "item";
  return bodyResponse(site, itemWriter, "item", status, shape, media);
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
  return op === DELETE_OP && status === NO_CONTENT ? DEFAULT_STATUS : status;
}

const listShape = (node: TreeNode): IrWriter.ResponseShape =>
  treeNodesSetting(node, "paging") === PAGING_NONE ? "list" : "page";

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

  checkNotHeaderUnion(site, body, origin, "response body");
  return [
    {
      status,
      ...(body.kind === "file" ? {} : { media }),
      body,
      shape: body.kind === "file" ? "binary" : shape,
      headers: [],
      origin: pipelineCopy(origin),
    },
  ];
}

// One entry of `responses`: its body and headers; a redirect status with no body.
function writtenResponse(site: TreeNodesSite, statusKey: string, media: string): IrWriter.Response {
  const pointer = `${site.node.pointer}/responses/${statusKey}`;
  const entry = treeNodesMember(treeNodesSetting(site.node, "responses"), statusKey);
  const origin = site.context.origin(pointer) ?? site.node.origin;
  const status = Number(statusKey);
  const headers = responseHeaders(site, treeNodesMember(entry, "headers"), `${pointer}/headers`);

  const writtenBody = treeNodesMember(entry, "body");
  const body =
    writtenBody === undefined
      ? undefined
      : site.context.treeSchemas.typeUse(`${pointer}/body`, "output");

  if (REDIRECT_STATUSES.includes(status)) {
    if (writtenBody !== undefined) reportRedirectBody(site, status, `${pointer}/body`);
    return { status, shape: "redirect", headers, origin: pipelineCopy(origin) };
  }
  if (body === undefined) return { status, shape: "empty", headers, origin: pipelineCopy(origin) };

  checkNotHeaderUnion(site, body, origin, "response body");
  const isFile = body.kind === "file";
  return {
    status,
    ...(isFile ? {} : { media }),
    body,
    shape: isFile ? "binary" : "item",
    headers,
    origin: pipelineCopy(origin),
  };
}

function responseHeaders(
  site: TreeNodesSite,
  written: Parameters<typeof treeNodesMember>[0] | undefined,
  pointer: string,
): IrWriter.ResponseHeader[] {
  const headers: IrWriter.ResponseHeader[] = [];
  const seen = new Set<string>();
  for (const field of treeNodesFields(site, written, pointer, "output").fields) {
    const name = field.name.toLowerCase();
    if (seen.has(name) || field.type === undefined) continue;
    seen.add(name);
    if (!treeNodesFieldTravels(site, field, "response header")) continue;
    headers.push({
      name: field.name,
      type: field.type,
      required: field.required,
      origin: pipelineCopy(field.origin),
    });
  }
  return headers;
}

function checkNotHeaderUnion(
  site: TreeNodesSite,
  use: IrWriter.TypeUse,
  origin: Origin,
  position: string,
): void {
  if (treeNodesTagHeader(site.draft, treeNodesInnermost(use)) === undefined) return;
  const located = treeNodesNodeOrigin(origin);
  site.once(
    `header-union:${located.layer}#${located.pointer}`,
    treeNodesHeaderUnionError(site, located, position),
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
