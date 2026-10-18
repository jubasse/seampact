import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import type { TreeNodesSite } from "./fields.js";
import { treeNodesIdParam, treeNodesOpOwner } from "./names.js";
import {
  type TreeNodesJson,
  treeNodesAnsweredUse,
  treeNodesDraftSchema,
  treeNodesIsObject,
  treeNodesMember,
  treeNodesPointer,
  treeNodesSetting,
} from "./raw.js";

// Route examples (ADR 0002 section 12, FR-3): every written example is kept. A request example is parsed against
// the input, a success example against what the handler returns for its status (the payload, the item array of a
// list, the id-keyed object of a table, each key read by the id schema); an error example is written unchecked,
// since derive.errors checks it against its code's params (ADR 0006 section 3).

// The shapes whose handler result is an array of the body's item.
const ARRAY_SHAPES: readonly IrWriter.ResponseShape[] = ["list", "page"];
const TABLE_SHAPE: IrWriter.ResponseShape = "table";

/** The examples a route writes, each checked where it targets the request or a success status. */
export function treeNodesExamples(
  site: TreeNodesSite,
  input: IrWriter.TypeUse | undefined,
  responses: readonly IrWriter.Response[],
): Record<string, IrWriter.OperationExample> {
  const written = treeNodesSetting(site.node, "examples");
  const examples: Record<string, IrWriter.OperationExample> = Object.create(null);

  if (!treeNodesIsObject(written)) return examples;

  for (const [name, entry] of Object.entries(written)) {
    const example = exampleOf(entry);
    const pointer = treeNodesPointer(`${site.node.pointer}/examples`, name);

    examples[name] = example;
    const value = treeNodesMember(entry, "value");

    checkExample(site, { name, pointer, example, value }, { input, responses });
  }

  return examples;
}

function exampleOf(entry: TreeNodesJson): IrWriter.OperationExample {
  const status = treeNodesMember(entry, "status");
  const request = treeNodesMember(entry, "request");
  const error = treeNodesMember(entry, "error");

  return {
    ...(typeof status === "number" ? { status } : {}),
    ...(request === true ? { request } : {}),
    ...(typeof error === "string" ? { error } : {}),
    value: pipelineCopy(treeNodesMember(entry, "value")),
  };
}

interface ExampleTargets {
  readonly input: IrWriter.TypeUse | undefined;
  readonly responses: readonly IrWriter.Response[];
}

/** A written example: its name, its pointer, the record written to the draft and its raw value. */
interface WrittenExample {
  readonly name: string;
  readonly pointer: string;
  readonly example: IrWriter.OperationExample;
  readonly value: TreeNodesJson | undefined;
}

function checkExample(site: TreeNodesSite, written: WrittenExample, targets: ExampleTargets): void {
  const { name, pointer, example } = written;
  const stated = [example.status, example.request, example.error].filter(
    (target) => target !== undefined,
  );

  if (stated.length !== 1) {
    reportTarget(site, name, pointer, "targets no single status, request or error");

    return;
  }

  if (example.error !== undefined) return;

  if (example.request === true) {
    if (targets.input === undefined)
      reportTarget(site, name, pointer, "targets the request, but the route has no input");
    else checkValue(site, name, `${pointer}/value`, written.value, targets.input);

    return;
  }

  const response = targets.responses.find((candidate) => candidate.status === example.status);
  const status = String(example.status);

  if (response === undefined) {
    reportTarget(
      site,
      name,
      pointer,
      `targets the status ${status}, which the route does not declare`,
    );

    return;
  }

  if (response.body === undefined) {
    reportTarget(site, name, pointer, `targets the status ${status}, which answers no body`);

    return;
  }

  checkSuccess(site, name, `${pointer}/value`, written.value, response);
}

function checkSuccess(
  site: TreeNodesSite,
  name: string,
  pointer: string,
  value: TreeNodesJson | undefined,
  response: IrWriter.Response,
): void {
  const body = response.body;

  if (body === undefined) return;

  if (ARRAY_SHAPES.includes(response.shape)) {
    checkValue(site, name, pointer, value, { kind: "array", items: body });

    return;
  }

  if (response.shape !== TABLE_SHAPE) {
    checkValue(site, name, pointer, value, body);

    return;
  }

  // A table has no type use of its own: each entry is one record.
  if (!treeNodesIsObject(value)) {
    reportIssue(site, name, pointer, {
      pointer: "",
      message: "a table example is an object keyed by id",
    });

    return;
  }

  const idUse = tableIdUse(site);

  for (const [id, record] of Object.entries(value)) {
    const entryPointer = treeNodesPointer(pointer, id);

    for (const issue of site.context.treeSchemas.checkTextExample(id, idUse))
      reportKeyIssue(site, { name, pointer: entryPointer, key: id }, issue.message);

    checkValue(site, name, entryPointer, record, body);
  }
}

// A table is keyed by the id of the batch op's collection, read in its text form: the entry of an `id` fields map,
// or the one property of the object schema `id` names (as tree.schemas reads the batch ids).
function tableIdUse(site: TreeNodesSite): IrWriter.TypeUse {
  const collection = treeNodesOpOwner(site.node);
  const idParam =
    collection === undefined
      ? undefined
      : treeNodesIdParam(collection, site.context.raw.merged.schemas);

  if (collection === undefined || idParam === undefined)
    throw new Error(`the table response of ${site.node.pointer} has no collection id`);

  const idPointer = treeNodesPointer(collection.pointer, "id");

  if (typeof treeNodesSetting(collection, "id") !== "string")
    return treeNodesAnsweredUse(site.context, treeNodesPointer(idPointer, idParam), "input");

  const named = treeNodesAnsweredUse(site.context, idPointer, "input");
  const schema = named.kind === "ref" ? treeNodesDraftSchema(site.draft, named.schema) : undefined;
  const [only, ...others] = schema?.kind === "object" ? schema.properties : [];

  if (only === undefined || others.length > 0)
    throw new Error(`the id schema of ${collection.pointer} is no object of one property`);

  return pipelineCopy(only.type);
}

function checkValue(
  site: TreeNodesSite,
  name: string,
  pointer: string,
  value: unknown,
  use: IrWriter.TypeUse,
): void {
  for (const issue of site.context.treeSchemas.checkExample(value, use))
    reportIssue(site, name, pointer, issue);
}

function reportIssue(
  site: TreeNodesSite,
  name: string,
  pointer: string,
  issue: { readonly pointer: string; readonly message: string },
): void {
  const origin =
    site.context.origin(`${pointer}${issue.pointer}`) ??
    site.context.origin(pointer) ??
    site.node.origin;

  const at = issue.pointer === "" ? "" : ` at '${issue.pointer}'`;

  site.context.report(
    treeNodesError({
      rule: "example-value",
      origin: treeNodesNodeOrigin(origin),
      message: `The example ${name} of ${site.operationId} does not fit its schema${at}: ${issue.message}.`,
      fix: "Correct the example value, or the schema it is parsed against.",
    }),
  );
}

/** A key of a table example: the example's name, the pointer of its entry and the key as written. */
interface TableKey {
  readonly name: string;
  readonly pointer: string;
  readonly key: string;
}

function reportKeyIssue(site: TreeNodesSite, tableKey: TableKey, why: string): void {
  site.context.report(
    treeNodesError({
      rule: "example-value",
      origin: treeNodesNodeOrigin(site.context.origin(tableKey.pointer) ?? site.node.origin),
      message: `The example ${tableKey.name} of ${site.operationId} has the key ${quote(tableKey.key)}, which does not read as the id: ${why}.`,
      fix: "Key each entry of the table by an id the collection's id schema reads.",
    }),
  );
}

function reportTarget(site: TreeNodesSite, name: string, pointer: string, why: string): void {
  site.context.report(
    treeNodesError({
      rule: "example-target",
      origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? site.node.origin),
      message: `The example ${name} of ${site.operationId} ${why}.`,
      fix: "Give the example one of status (a success with a body), request: true (on a route with input) or error.",
    }),
  );
}
