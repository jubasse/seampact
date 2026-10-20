import { type Refusal, withoutRepeats } from "@seampact/codegen-core";
import type { ApiDocument, ContractIR, DocumentId } from "@seampact/spec/ir";
import {
  apiExtensionValue,
  buildPlannedDocument,
  everySurfaceSelection,
  unsupportedIrRefusals,
} from "../documents.js";
import type { EmitterOptions } from "../emitter-options.js";
import { serializeDocument } from "../serialize.js";
import { type ApiSource, assembleMergedDocument } from "./merged-document.js";
import { isValidPrefix, prefixDocument } from "./prefix-document.js";

// A monorepo root's merged document (ADR 0004 section 12, ADR 0011 "Which OpenAPI documents exist"): each api's
// document mapped by the table under the merged document's options, its `prefix` applied, then written as one.

/** One api a merged document holds, as an app serves or documents it. */
export interface MergeInput {
  /** The api's IR, holding only the operations the contributing app serves. */
  ir: ContractIR;
  /** The `api.documents` key the app names; absent for every surface with internal routes kept. */
  document?: DocumentId;
}

export interface MergeOptions {
  /** The merged document's name in the root config, its `info.title`. */
  name: string;
  /** A prefix per api name for its operation ids and component keys. */
  prefix: Readonly<Record<string, string>>;
  emitter: EmitterOptions;
}

export type MergeOutcome =
  | { status: "merged"; text: string }
  | { status: "refused"; refusals: readonly Refusal[] };

/** The merged document of several apis, or the refusals that stop it, each naming the apis and the fix. */
export function mergeDocuments(inputs: readonly MergeInput[], options: MergeOptions): MergeOutcome {
  if (inputs.length === 0) {
    return refused([
      {
        code: "openapi.merge.empty",
        message: `The merged document '${options.name}' holds no api: no app it covers serves or documents one.`,
        fix: "List in its 'apps' an app with a server target or an OpenAPI-only app, or remove the document.",
      },
    ]);
  }

  const refusals: Refusal[] = prefixRefusals(inputs, options);
  const sources: ApiSource[] = [];

  for (const input of inputs) {
    const built = buildInputDocument(input, options);

    if (built.status === "refused") refusals.push(...built.refusals);
    else sources.push(built.source);
  }

  if (refusals.length > 0) return refused(withoutRepeats(refusals));

  const assembled = assembleMergedDocument(sources, options);

  if (assembled.refusals.length > 0) return refused(withoutRepeats(assembled.refusals));

  return { status: "merged", text: serializeDocument(assembled.document) };
}

function refused(refusals: readonly Refusal[]): MergeOutcome {
  return { status: "refused", refusals };
}

// Each prefix names an api of the document and is a component key segment.
function prefixRefusals(inputs: readonly MergeInput[], options: MergeOptions): Refusal[] {
  const apiNames = new Set(inputs.map((input) => input.ir.api.id));
  const refusals: Refusal[] = [];

  for (const [api, prefix] of Object.entries(options.prefix)) {
    if (!apiNames.has(api)) {
      refusals.push({
        code: "openapi.merge.prefix-api",
        message: `The merged document '${options.name}' sets a prefix for '${api}', an api none of its apps gives.`,
        fix: `Name one of ${[...apiNames].sort().join(", ")} in 'prefix', or remove '${api}'.`,
      });
    }

    if (!isValidPrefix(prefix)) {
      refusals.push({
        code: "openapi.merge.prefix-invalid",
        message: `The prefix '${prefix}' of '${api}' is not an OpenAPI component key segment.`,
        fix: "Write the prefix with letters, digits, '.', '-' and '_' only, such as 'billing'.",
      });
    }
  }

  return refusals;
}

function buildInputDocument(
  input: MergeInput,
  options: MergeOptions,
): { status: "built"; source: ApiSource } | { status: "refused"; refusals: readonly Refusal[] } {
  const { ir } = input;
  const api = ir.api.id;
  const unsupported = unsupportedIrRefusals(ir);

  if (unsupported.length > 0) return { status: "refused", refusals: unsupported };

  const selection = inputSelection(input);

  if (selection === undefined) {
    return {
      status: "refused",
      refusals: [
        {
          code: "openapi.merge.unknown-document",
          message: `The api '${api}' declares no document '${input.document}'.`,
          fix: `Name one of ${Object.keys(ir.api.documents).sort().join(", ") || "no document"} in the app's config, or leave the document out to give every route.`,
          member: "/api/documents",
        },
      ],
    };
  }

  const built = buildPlannedDocument(ir, options.emitter, selection);

  if (built.refusals.length > 0) {
    return {
      status: "refused",
      refusals: built.refusals.map((refusal) => ({
        ...refusal,
        message: `${refusal.message} (api '${api}')`,
      })),
    };
  }

  const prefix = options.prefix[api];
  const document = prefix === undefined ? built.document : prefixDocument(built.document, prefix);

  return { status: "built", source: { api, apiValue: apiExtensionValue(ir), document } };
}

function inputSelection(input: MergeInput): ApiDocument | undefined {
  if (input.document === undefined) return everySurfaceSelection(input.ir);

  const selection = input.ir.api.documents[input.document];

  return selection === undefined ? undefined : structuredClone(selection);
}
