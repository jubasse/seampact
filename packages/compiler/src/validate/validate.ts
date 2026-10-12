// The validate stage (ADR 0006 section 1): the raw tree checked against the authoring JSON Schemas,
// refused schema keywords reported with ADR 0003's reasons.

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
export function validateSortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
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
  return validateSortDiagnostics(
    convertErrors(validate.errors ?? [], { layer, isPackRoot: kind === "pack" }),
  );
}

export function validateLayer(layer: RawLayer): Diagnostic[] {
  return validateDocument(LAYER_SCHEMA[layerKindOf(layer.layer)], layer.tree, layer.layer);
}

// Every layer of every api, each file once: the shared file and a pack reached by several apis
// are one layer, validated once.
export function validateWorkspace(workspace: RawWorkspace): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const api of workspace.apis) {
    for (const layer of api.layers) {
      const id = `${layer.layer}\u0000${layer.file}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(...validateLayer(layer));
    }
  }
  return validateSortDiagnostics(out);
}
