// The validate stage (ADR 0006 section 1): the raw tree checked against the authoring JSON Schemas,
// refused schema keywords reported with ADR 0003's reasons.
//
// Contract with the loader: the stage runs on trees whose `$include`s are resolved (ADR 0002
// section 2, rule 2). The schemas relieve a mapping holding `$include` of its required keys, which
// is right for an editor reading one file, but would let `access: { $include: ./x.yaml }` hide an
// included `{ public: '' }` here; the access and reason checks below hold only after resolution.

import {
  AUTHORING_FILES,
  type AuthoringFile,
  authoringSchemaFileName,
  authoringSchemas,
} from "@seampact/spec/authoring";
import type { Origin } from "@seampact/spec/ir";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import {
  type JsonValue,
  type LayerKind,
  layerKindOf,
  type RawLayer,
  type RawWorkspace,
} from "../raw-tree.js";
import { convertErrors } from "./diagnostics.js";

// The kinds a document may be validated as: the file kinds and the fragment kinds.
export type ValidateDocumentKind = Exclude<AuthoringFile, "common">;

// An absolute base for the relative `$ref`s between the authoring schemas; never fetched.
const BASE_URI = "https://seampact.invalid/authoring/";

const LAYER_SCHEMA: Record<LayerKind, ValidateDocumentKind> = {
  api: "api",
  base: "base",
  shared: "base",
  pack: "pack",
};

let ajv: Ajv2020 | undefined;
const compiled = new Map<ValidateDocumentKind, ValidateFunction>();

// The schemas are added once and each kind compiled on first use.
function validatorFor(kind: ValidateDocumentKind): ValidateFunction {
  const cached = compiled.get(kind);
  if (cached !== undefined) return cached;
  if (ajv === undefined) {
    ajv = new Ajv2020({ strict: true, allErrors: true, verbose: true });
    const schemas = authoringSchemas();
    for (const file of AUTHORING_FILES) {
      ajv.addSchema({ ...schemas[file], $id: BASE_URI + authoringSchemaFileName(file) });
    }
  }
  const validate = ajv.getSchema(BASE_URI + authoringSchemaFileName(kind));
  if (validate === undefined) throw new Error(`no authoring schema for ${kind}`);
  compiled.set(kind, validate);
  return validate;
}

// ADR 0006 section 4 sorts by file, line, column, rule; without the side table, the stage sorts by
// layer, then pointer, then rule, so its output is stable on its own.
function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const key = (d: Diagnostic): string[] => [d.origin.layer, d.origin.pointer, d.rule, d.message];
  return [...diagnostics].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const x = ka[i] ?? "";
      const y = kb[i] ?? "";
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });
}

// One document (a layer's tree, the workspace file, or a fragment) validated as `kind`.
export function validateDocument(
  kind: ValidateDocumentKind,
  tree: JsonValue,
  layer: Origin["layer"],
): Diagnostic[] {
  const validate = validatorFor(kind);
  if (validate(tree)) return [];
  return sortDiagnostics(
    convertErrors(validate.errors ?? [], { layer, isPackRoot: kind === "pack" }),
  );
}

export function validateLayer(layer: RawLayer): Diagnostic[] {
  return validateDocument(LAYER_SCHEMA[layerKindOf(layer.layer)], layer.tree, layer.layer);
}

// The diagnostics listed under one api: their origins name layers that api reaches, so a consumer
// locates them through that api's `locations` table.
export interface ApiDiagnostics {
  api: string;
  diagnostics: Diagnostic[];
}

// The validate stage's output for a workspace.
export interface WorkspaceDiagnostics {
  // The workspace entry file's own diagnostics (kind `workspace`), located through
  // `RawWorkspace.locations` under `workspace#<pointer>`; empty when the entry is a single api
  // file, which is listed as the api's own layer.
  workspace: Diagnostic[];
  // One entry per api, in workspace order.
  apis: ApiDiagnostics[];
}

// Every layer of every api, each file once: a layer reached by several apis (the shared file, a
// pack) is validated once and its diagnostics listed under the first api that reaches it. An empty
// api entry means no diagnostic is listed there, not that every layer the api reaches is valid.
// Any diagnostic in any entry, `workspace` included, stops the pipeline after this stage
// (ADR 0006 section 1).
export function validateWorkspace(workspace: RawWorkspace): WorkspaceDiagnostics {
  const seen = new Set<string>();
  const apis = workspace.apis.map((api) => {
    const diagnostics: Diagnostic[] = [];
    for (const layer of api.layers) {
      const id = `${layer.layer}\u0000${layer.file}`;
      if (seen.has(id)) continue;
      seen.add(id);
      diagnostics.push(...validateLayer(layer));
    }
    return { api: api.name, diagnostics: sortDiagnostics(diagnostics) };
  });
  const entry = workspace.entry;
  return {
    workspace: entry ? validateDocument("workspace", entry.tree, entry.layer) : [],
    apis,
  };
}
