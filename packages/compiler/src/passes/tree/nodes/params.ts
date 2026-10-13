import type { IrWriter, Origin } from "@seampact/spec/ir";
import { pipelineCopy, type TreeNode } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesLocate, treeNodesNodeOrigin } from "./diagnostics.js";
import {
  type TreeNodesField,
  type TreeNodesSite,
  treeNodesFields,
  treeNodesFieldTravels,
} from "./fields.js";
import { treeNodesMember, treeNodesSetting, treeNodesTagHeader } from "./raw.js";

// The parameters a route declares (ADR 0002 sections 6 to 8): path parameters from the member ids and `pathParams`
// along its path, query fields and request headers inherited down the tree (`query` reaching safe routes only),
// each name once per list; and the policy for undeclared query keys (`unknownQuery`, else
// `conventions.query.unknownKeys`). Derived parameters are added by later halves.

type Json = Parameters<typeof treeNodesMember>[0];

type ParamList = "path" | "query" | "header";

const PLACE: Record<ParamList, string> = {
  path: "path parameter",
  query: "query field",
  header: "request header",
};

const PLACEHOLDER = /\{([^{}]+)\}/g;
const REFUSE = "refuse";

/** One route's declared parameters. */
export function treeNodesParams(
  site: TreeNodesSite,
  path: string | undefined,
  safe: boolean,
  input: IrWriter.TypeUse | undefined,
): IrWriter.Params {
  const pathFields = pathParamFields(site);
  if (path !== undefined) checkPlaceholders(site, path, pathFields);

  const header = paramsOf(
    site,
    inheritedFields(site, "headers", () => true),
    "header",
  );
  checkTagHeaderNotDeclared(site, header, input);

  return {
    path: paramsOf(site, pathFields.fields, "path"),
    query: paramsOf(
      site,
      inheritedFields(site, "query", (at) => at === site.node || safe),
      "query",
    ),
    header,
  };
}

// The member id of each collection whose member scope the route sits in, and each node's `pathParams`, from the
// surface down: the order the placeholders appear in the path.
function pathParamFields(site: TreeNodesSite): { fields: TreeNodesField[]; complete: boolean } {
  const fields: TreeNodesField[] = [];
  let complete = true;
  for (const at of chainOf(site.node)) {
    const collection = at.kind === "scope" && at.name === "member" ? at.parent : undefined;
    if (collection !== undefined) {
      const id = treeNodesFields(
        site,
        treeNodesSetting(collection, "id"),
        `${collection.pointer}/id`,
        "input",
      );
      fields.push(...id.fields.map((field) => ({ ...field, required: true })));
    }

    const declared = treeNodesFields(
      site,
      treeNodesSetting(at, "pathParams"),
      `${at.pointer}/pathParams`,
      "input",
    );
    complete &&= declared.complete;
    fields.push(...declared.fields.map((field) => ({ ...field, required: true })));
  }
  return { fields, complete };
}

function chainOf(node: TreeNode): TreeNode[] {
  const chain: TreeNode[] = [];
  for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent) chain.unshift(at);
  return chain;
}

// An inherited fields map (`query`, `headers`): each node that writes one, from the root down, kept by `reaches`.
function inheritedFields(
  site: TreeNodesSite,
  setting: "query" | "headers",
  reaches: (at: TreeNode) => boolean,
): TreeNodesField[] {
  const inherited = site.context.inherited(site.node, setting);
  if (inherited === undefined) return [];

  const writers: TreeNode[] = [];
  for (const entry of inherited.entries)
    if (!writers.includes(entry.node) && reaches(entry.node)) writers.push(entry.node);

  return writers.flatMap(
    (at) =>
      treeNodesFields(site, treeNodesSetting(at, setting), `${at.pointer}/${setting}`, "input")
        .fields,
  );
}

// Each field once per list (a header name in any case), with a type the service answers, and that may travel there.
function paramsOf(
  site: TreeNodesSite,
  fields: readonly TreeNodesField[],
  list: ParamList,
): IrWriter.Param[] {
  const params: IrWriter.Param[] = [];
  const seen = new Map<string, TreeNodesField>();

  for (const field of fields) {
    const key = list === "header" ? field.name.toLowerCase() : field.name;
    const first = seen.get(key);
    if (first !== undefined) {
      reportTwice(site, field, first, list);
      continue;
    }
    seen.set(key, field);

    if (field.type === undefined || !treeNodesFieldTravels(site, field, PLACE[list])) continue;
    const wire =
      list === "query" ? site.context.treeSchemas.queryWire(field.wirePointer) : undefined;
    params.push({
      name: field.name,
      type: field.type,
      required: field.required,
      ...(wire === undefined ? {} : { wire }),
      origin: pipelineCopy(field.origin),
    });
  }
  return params;
}

function reportTwice(
  site: TreeNodesSite,
  field: TreeNodesField,
  first: TreeNodesField,
  list: ParamList,
): void {
  const fallback = treeNodesNodeOrigin(site.node.origin);
  const origin = treeNodesLocate(field.origin, fallback);
  site.once(
    `param-unique:${origin.layer}#${origin.pointer}:${field.name}`,
    treeNodesError({
      rule: "param-unique",
      origin,
      message: `The ${PLACE[list]} ${field.name} of ${site.operationId} is declared twice.`,
      fix: "Remove one of the two declarations.",
      related: [
        { origin: treeNodesLocate(first.origin, fallback), message: "the first declaration" },
      ],
    }),
  );
}

// Every placeholder of the path names a path parameter, and every path parameter has its placeholder.
function checkPlaceholders(
  site: TreeNodesSite,
  path: string,
  pathFields: { fields: readonly TreeNodesField[]; complete: boolean },
): void {
  const placeholders = [...path.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
  const declared = pathFields.fields.map(({ name }) => name);
  const nodeOrigin = treeNodesNodeOrigin(site.node.origin);

  if (pathFields.complete)
    for (const placeholder of placeholders.filter((name) => !declared.includes(name)))
      site.context.report(
        treeNodesError({
          rule: "path-param",
          origin: nodeOrigin,
          message: `The path ${path} of ${site.operationId} holds {${placeholder}}, which no pathParams or id declares.`,
          fix: `Declare ${placeholder} in pathParams.`,
        }),
      );

  for (const field of pathFields.fields.filter(({ name }) => !placeholders.includes(name))) {
    const origin = treeNodesLocate(field.origin, nodeOrigin);
    site.once(
      `path-param:${origin.layer}#${origin.pointer}:${field.name}`,
      treeNodesError({
        rule: "path-param",
        origin,
        message: `The path parameter ${field.name} of ${site.operationId} is not in its path ${path}.`,
        fix: `Write {${field.name}} in the path, or remove the parameter.`,
      }),
    );
  }
}

// A header-tagged input adds its tag header itself (ADR 0003 section 4), so the route declares it no second time.
function checkTagHeaderNotDeclared(
  site: TreeNodesSite,
  headers: readonly IrWriter.Param[],
  input: IrWriter.TypeUse | undefined,
): void {
  const tagHeader = treeNodesTagHeader(site.draft, input)?.toLowerCase();
  const declared = headers.find(({ name }) => name.toLowerCase() === tagHeader);
  if (declared?.origin === undefined) return;

  site.context.report(
    treeNodesError({
      rule: "header-union",
      origin: treeNodesLocate(declared.origin, treeNodesNodeOrigin(site.node.origin)),
      message: `The request header ${declared.name} of ${site.operationId} is the tag of its input union, which adds it.`,
      fix: "Remove the header; the union's discriminator adds it.",
    }),
  );
}

/** The policy for undeclared query keys: the nearest `unknownQuery`, else `conventions.query.unknownKeys`. */
export function treeNodesUnknownQuery(site: TreeNodesSite): IrWriter.UnknownQuery {
  const nearest = site.context.inherited(site.node, "unknownQuery");
  if (nearest !== undefined) return policyOf(nearest.entry.value, nearest.entry.origin);

  const reading = site.context.conventions.get("query.unknownKeys");
  return policyOf(reading?.value, reading?.origin);
}

function policyOf(value: Json | undefined, origin: Origin | undefined): IrWriter.UnknownQuery {
  if (value === REFUSE) return { policy: "refuse" };

  const reason = treeNodesMember(value, "ignore");
  if (typeof reason !== "string" || origin === undefined)
    throw new Error(
      `an unknown-query policy is refuse or { ignore: <reason> }, got ${JSON.stringify(value)}`,
    );
  return { policy: "ignore", reason, origin: pipelineCopy(origin) };
}
