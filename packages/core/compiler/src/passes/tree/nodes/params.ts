import type { IrWriter, Origin } from "@seampact/spec/ir";
import type { DiagnosticOrigin } from "../../../diagnostics/diagnostic.js";
import { pipelineCopy, type TreeNode } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesLocate, treeNodesNodeOrigin } from "./diagnostics.js";
import {
  type TreeNodesField,
  type TreeNodesSite,
  treeNodesFields,
  treeNodesFieldTravels,
} from "./fields.js";
import type { TreeNodesPath } from "./paths.js";
import {
  type TreeNodesJson,
  treeNodesMember,
  treeNodesSetting,
  treeNodesTagHeader,
} from "./raw.js";

// The parameters a route declares (ADR 0002 sections 6 to 8): path parameters from the member ids and `pathParams`
// along its path, query fields and request headers inherited down the tree (`query` reaching safe routes only),
// each name once per list; and the policy for undeclared query keys (`unknownQuery`, else
// `conventions.query.unknownKeys`). Derived parameters are added by later halves.

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
  path: TreeNodesPath | undefined,
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

  const queryFields = inheritedFields(site, "query", (at) => at === site.node || safe);
  checkQueryNotNamedLikePath(site, pathFields.fields, queryFields);

  return {
    path: paramsOf(site, pathFields.fields, "path"),
    query: paramsOf(site, queryFields, "query"),
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
    const param = paramOf(site, field, field.type, list);
    if (param !== undefined) params.push(param);
  }
  return params;
}

// A query field carries its query wire; one the service answers no wire for has no query encoding.
function paramOf(
  site: TreeNodesSite,
  field: TreeNodesField,
  type: IrWriter.TypeUse,
  list: ParamList,
): IrWriter.Param | undefined {
  const param: IrWriter.Param = {
    name: field.name,
    type: pipelineCopy(type),
    required: field.required,
    origin: pipelineCopy(field.origin),
  };
  if (list !== "query") return param;

  const wire = site.context.treeSchemas.queryWire(field.wirePointer);
  if (wire !== undefined) return { ...param, wire: pipelineCopy(wire) };

  const origin = treeNodesLocate(field.origin, treeNodesNodeOrigin(site.node.origin));
  site.once(
    `query-field:${origin.layer}#${origin.pointer}:${field.name}`,
    treeNodesError({
      rule: "query-field",
      origin,
      message: `The query field ${field.name} of ${site.operationId} has no query encoding.`,
      fix: "Give the field a number, boolean, text, enum or list of them, or an object of them.",
    }),
  );
  return undefined;
}

// Merged-bag frameworks read a path parameter and a query key of one name as one value, so a query field takes no
// path parameter's name (a stricter rule than the grammar's). Body and form fields may.
function checkQueryNotNamedLikePath(
  site: TreeNodesSite,
  pathFields: readonly TreeNodesField[],
  queryFields: readonly TreeNodesField[],
): void {
  const fallback = treeNodesNodeOrigin(site.node.origin);
  for (const query of queryFields) {
    const path = pathFields.find(({ name }) => name === query.name);
    if (path === undefined) continue;

    const origin = treeNodesLocate(query.origin, fallback);
    site.once(
      `param-unique:${origin.layer}#${origin.pointer}:${query.name}:path`,
      treeNodesError({
        rule: "param-unique",
        origin,
        message: `The query field ${query.name} of ${site.operationId} has the name of its path parameter, which frameworks merging both read as one value.`,
        fix: "Rename one of the two.",
        related: [
          { origin: treeNodesLocate(path.origin, fallback), message: "the path parameter" },
        ],
      }),
    );
  }
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

// Every placeholder of the path names a path parameter, once, and every path parameter has its placeholder. A
// placeholder is reported where its path part is written, so a parent's path is reported once, not per route.
function checkPlaceholders(
  site: TreeNodesSite,
  path: TreeNodesPath,
  pathFields: { fields: readonly TreeNodesField[]; complete: boolean },
): void {
  const declared = pathFields.fields.map(({ name }) => name);
  const nodeOrigin = treeNodesNodeOrigin(site.node.origin);
  const placeholders: string[] = [];

  for (const part of path.parts)
    for (const placeholder of placeholdersOf(part.text)) {
      const origin = treeNodesLocate(part.origin, nodeOrigin);
      const repeated = placeholders.includes(placeholder);
      placeholders.push(placeholder);
      if (repeated) reportRepeatedPlaceholder(site, path.full, placeholder, origin);
      else if (pathFields.complete && !declared.includes(placeholder))
        reportUndeclaredPlaceholder(site, path.full, placeholder, origin);
    }

  for (const field of pathFields.fields.filter(({ name }) => !placeholders.includes(name))) {
    const origin = treeNodesLocate(field.origin, nodeOrigin);
    site.once(
      `path-param:${origin.layer}#${origin.pointer}:${field.name}`,
      treeNodesError({
        rule: "path-param",
        origin,
        message: `The path parameter ${field.name} of ${site.operationId} is not in its path ${path.full}.`,
        fix: `Write {${field.name}} in the path, or remove the parameter.`,
      }),
    );
  }
}

const placeholdersOf = (text: string): string[] =>
  [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");

function reportUndeclaredPlaceholder(
  site: TreeNodesSite,
  path: string,
  placeholder: string,
  origin: DiagnosticOrigin,
): void {
  site.once(
    `path-param:${origin.layer}#${origin.pointer}:{${placeholder}}`,
    treeNodesError({
      rule: "path-param",
      origin,
      message: `The path ${path} of ${site.operationId} holds {${placeholder}}, which no pathParams or id declares.`,
      fix: `Declare ${placeholder} in pathParams.`,
    }),
  );
}

function reportRepeatedPlaceholder(
  site: TreeNodesSite,
  path: string,
  placeholder: string,
  origin: DiagnosticOrigin,
): void {
  site.once(
    `path-param:${origin.layer}#${origin.pointer}:{${placeholder}}`,
    treeNodesError({
      rule: "path-param",
      origin,
      message: `The path ${path} of ${site.operationId} holds {${placeholder}} twice, so one parameter would fill two segments.`,
      fix: "Rename one of the two placeholders and declare it.",
    }),
  );
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

  const origin = treeNodesLocate(declared.origin, treeNodesNodeOrigin(site.node.origin));
  site.once(
    `union-header:${origin.layer}#${origin.pointer}:${site.node.pointer}`,
    treeNodesError({
      rule: "union-header",
      origin,
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

function policyOf(
  value: TreeNodesJson | undefined,
  origin: Origin | undefined,
): IrWriter.UnknownQuery {
  if (value === REFUSE) return { policy: "refuse" };

  const reason = treeNodesMember(value, "ignore");
  if (typeof reason !== "string" || origin === undefined)
    throw new Error(
      `an unknown-query policy is refuse or { ignore: <reason> }, got ${JSON.stringify(value)}`,
    );
  return { policy: "ignore", reason, origin: pipelineCopy(origin) };
}
