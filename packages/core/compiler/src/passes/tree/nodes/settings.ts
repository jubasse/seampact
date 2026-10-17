import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  pipelineConventionLeaves,
  pipelineCopy,
  pipelineTreeNodes,
} from "../../../pipeline/seam.js";
import {
  TREE_NODES_MATURITIES,
  type TreeNodesContext,
  type TreeNodesJson,
  treeNodesIsObject,
  treeNodesMember,
  treeNodesPointer,
  treeNodesWrittenConvention,
} from "./raw.js";

// The api-wide members of tree.nodes (ADR 0004 section 2): the written conventions with their origins, lint
// severities and allows, the packs applied, and the services catalogue.

const LINT_SEVERITIES: readonly IrWriter.LintSeverity[] = ["disabled", "warning", "error"];

const PACK_LAYER_PREFIX = "pack:";

// An allow of this rule holds for its own node only (ADR 0002 sections 8 and 12).
const NODE_ONLY_RULE = "seampact/subtree-exception";

// The catalogues whose entries take `lint.allow` (ADR 0002 section 12); an allow there holds for the entry only.
const ALLOWING_CATALOGUES = [
  "schemes",
  "identities",
  "rights",
  "rules",
  "scopes",
  "schemas",
] as const;

/** Writes `conventions`, `lint`, `packs` and `services` to the draft. */
export function treeNodesApiSettings(draft: DraftIR, context: TreeNodesContext): void {
  writeConventions(draft, context);
  draft.lint = { rules: lintRules(context), allows: lintAllows(context) };
  draft.packs.push(...packsOf(context));
  writeServices(draft, context);
}

// Written conventions only, keyed by leaf: a core default, or a default read from another key
// (`batch.bodyLimit` from `bodyLimit`), is no written value at that leaf.
function writeConventions(draft: DraftIR, context: TreeNodesContext): void {
  for (const path of pipelineConventionLeaves) {
    const reading = treeNodesWrittenConvention(context, path);
    if (reading === undefined) continue;
    draft.conventions[path] = {
      value: pipelineCopy(reading.value),
      origin: pipelineCopy(reading.origin),
    };
  }
}

function lintRules(context: TreeNodesContext): Record<string, IrWriter.LintRule> {
  const rules: Record<string, IrWriter.LintRule> = Object.create(null);
  const written = treeNodesMember(treeNodesMember(context.raw.merged, "lint"), "rules");
  if (!treeNodesIsObject(written)) return rules;

  for (const [rule, value] of Object.entries(written)) {
    const severity = LINT_SEVERITIES.find((candidate) => candidate === value);
    const origin = context.origin(treeNodesPointer("/lint/rules", rule));
    if (severity === undefined || origin === undefined)
      throw new Error(`the lint rule ${rule} has no severity or origin the grammar admits`);
    rules[rule] = { severity, origin: pipelineCopy(origin) };
  }
  return rules;
}

// Every `lint.allow`: on a tree node (reaching the nodes below it, except the subtree-exception rule), then on a
// catalogue entry, on a property of a declared schema at any depth, and on an inline schema a route writes and its
// properties (holding there only).
function lintAllows(context: TreeNodesContext): IrWriter.LintAllow[] {
  const allows: IrWriter.LintAllow[] = [];
  const add: AddAllows = (owner, pointer, onNode) => {
    const written = treeNodesMember(treeNodesMember(owner, "lint"), "allow");
    const at = context.origin(pointer);
    if (!treeNodesIsObject(written) || at === undefined) return;
    for (const [rule, reason] of Object.entries(written)) {
      if (typeof reason !== "string") continue;
      allows.push({
        rule,
        at: pipelineCopy(at),
        reason,
        subtree: onNode && rule !== NODE_ONLY_RULE,
      });
    }
  };

  for (const node of pipelineTreeNodes(context.raw)) {
    add(node.settings, node.pointer, true);
    addRoutePositionAllows(node.settings, node.pointer, add);
  }

  for (const catalogue of ALLOWING_CATALOGUES) {
    const entries = treeNodesMember(context.raw.merged, catalogue);
    if (!treeNodesIsObject(entries)) continue;
    for (const [id, entry] of Object.entries(entries)) {
      const pointer = treeNodesPointer(`/${catalogue}`, id);
      add(entry, pointer, false);
      if (catalogue === "schemas") addNestedAllows(entry, pointer, add);
    }
  }
  return allows;
}

type AddAllows = (owner: TreeNodesJson | undefined, pointer: string, onNode: boolean) => void;

// The schema positions of a node (ADR 0002 sections 4 and 7): an inline schema there holds its own allows.
const ROUTE_SCHEMA_POSITIONS = ["input", "output", "item"] as const;
const ROUTE_FIELDS_MAPS = ["id", "pathParams", "query", "headers"] as const;

function addRoutePositionAllows(settings: TreeNodesJson, pointer: string, add: AddAllows): void {
  for (const position of ROUTE_SCHEMA_POSITIONS)
    addInlineSchemaAllows(treeNodesMember(settings, position), `${pointer}/${position}`, add);
  for (const map of ROUTE_FIELDS_MAPS)
    addFieldsMapAllows(treeNodesMember(settings, map), `${pointer}/${map}`, add);

  const responses = treeNodesMember(settings, "responses");
  if (!treeNodesIsObject(responses)) return;
  for (const [status, response] of Object.entries(responses)) {
    const at = treeNodesPointer(`${pointer}/responses`, status);
    addInlineSchemaAllows(treeNodesMember(response, "body"), `${at}/body`, add);
    addFieldsMapAllows(treeNodesMember(response, "headers"), `${at}/headers`, add);
  }
}

// A schema name holds no allow of its own; its declaration does.
function addInlineSchemaAllows(
  schema: TreeNodesJson | undefined,
  pointer: string,
  add: AddAllows,
): void {
  if (!treeNodesIsObject(schema)) return;
  add(schema, pointer, false);
  addNestedAllows(schema, pointer, add);
}

function addFieldsMapAllows(
  fields: TreeNodesJson | undefined,
  pointer: string,
  add: AddAllows,
): void {
  if (!treeNodesIsObject(fields)) return;
  for (const [name, field] of Object.entries(fields))
    addInlineSchemaAllows(field, treeNodesPointer(pointer, name), add);
}

// The allows below a schema: on each property, list item, variant and member, at any depth (ADR 0003).
function addNestedAllows(schema: TreeNodesJson | undefined, pointer: string, add: AddAllows): void {
  for (const member of NESTED_SCHEMA_MAPS) {
    const entries = treeNodesMember(schema, member);
    if (!treeNodesIsObject(entries)) continue;
    for (const [key, nested] of Object.entries(entries))
      addInlineSchemaAllows(nested, treeNodesPointer(pointer, member, key), add);
  }

  for (const member of NESTED_SCHEMA_LISTS) {
    const entries = treeNodesMember(schema, member);
    if (!Array.isArray(entries)) continue;
    entries.forEach((nested, index) => {
      addInlineSchemaAllows(nested, treeNodesPointer(pointer, member, String(index)), add);
    });
  }

  for (const member of NESTED_SCHEMAS)
    addInlineSchemaAllows(treeNodesMember(schema, member), treeNodesPointer(pointer, member), add);
}

// Where a schema holds other schemas: by name, in a list, or one schema.
const NESTED_SCHEMA_MAPS = ["properties", "oneOf"] as const;
const NESTED_SCHEMA_LISTS = ["allOf", "oneOf"] as const;
const NESTED_SCHEMAS = ["items", "additionalProperties", "contentSchema"] as const;

// The pack layers in application order (the loader's layer order), each with its manifest's name and version.
function packsOf(context: TreeNodesContext): IrWriter.PackRef[] {
  return context.raw.layers
    .filter(({ layer }) => layer.startsWith(PACK_LAYER_PREFIX))
    .map(({ layer, tree }) => {
      const manifest = treeNodesMember(tree, "pack");
      const name = treeNodesMember(manifest, "name");
      const version = treeNodesMember(manifest, "version");
      if (typeof name !== "string" || typeof version !== "string")
        throw new Error(`the pack layer ${layer} has no manifest name and version`);
      return { name, version };
    });
}

function writeServices(draft: DraftIR, context: TreeNodesContext): void {
  const written = treeNodesMember(context.raw.merged, "services");
  if (!treeNodesIsObject(written)) return;

  // A service that states no maturity is as mature as the api it serves: the grammar states none for it.
  const apiMaturity = draft.api?.maturity;
  for (const [id, service] of Object.entries(written)) {
    const stated = TREE_NODES_MATURITIES.find(
      (level) => level === treeNodesMember(service, "maturity"),
    );
    const maturity = stated ?? apiMaturity;
    const origin = context.origin(treeNodesPointer("/services", id));
    if (maturity === undefined || origin === undefined)
      throw new Error(
        `the service ${id} has no maturity or origin: write the api before its services`,
      );
    draft.services[id] = { id, maturity, origin: pipelineCopy(origin) };
  }
}
