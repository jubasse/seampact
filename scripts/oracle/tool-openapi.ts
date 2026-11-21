import { type ExpectedFiles, jsonText } from "./expected-text.ts";
import type { OracleTools, RefusalLike } from "./tool-modules.ts";

// The OpenAPI documents of an api (`openapi/<api>/<document>.yaml`, or `openapi/<api>.refusals.json`) and the merged
// document of a `merge.json` case (`openapi-merge/merged.yaml` or `openapi-merge/refusals.json`).

const DEFAULT_DOCUMENT = "default";

/** One input of a `merge.json`, its IR already read. */
export interface MergeInputCase {
  ir: object;
  document?: string;
}

export interface MergeCase {
  name: string;
  prefix: Record<string, string>;
  emitter?: unknown;
  inputs: MergeInputCase[];
}

function refusalFiles(path: string, refusals: readonly RefusalLike[]): ExpectedFiles {
  return new Map([[path, jsonText(refusals)]]);
}

/** The documents of one api as the IR text says it, the emitter options as the config writes them. */
export function openApiFiles(
  tools: OracleTools,
  api: string,
  irText: string,
  rawOptions?: unknown,
): ExpectedFiles {
  const refusalsPath = `openapi/${api}.refusals.json`;
  const parsed = tools.parseEmitterOptions(rawOptions);

  if (parsed.status === "refused") return refusalFiles(refusalsPath, parsed.refusals);

  const outcome = tools.emitDocuments(JSON.parse(irText), parsed.options);

  if (outcome.status === "refused") return refusalFiles(refusalsPath, outcome.refusals);

  return new Map(
    outcome.documents.map(({ name, text }) => [
      `openapi/${api}/${name ?? DEFAULT_DOCUMENT}.yaml`,
      text,
    ]),
  );
}

/** The merged document of one case. */
export function mergeFiles(tools: OracleTools, mergeCase: MergeCase): ExpectedFiles {
  const refusalsPath = "openapi-merge/refusals.json";
  const parsed = tools.parseEmitterOptions(mergeCase.emitter);

  if (parsed.status === "refused") return refusalFiles(refusalsPath, parsed.refusals);

  const outcome = tools.mergeDocuments(mergeCase.inputs, {
    name: mergeCase.name,
    prefix: mergeCase.prefix,
    emitter: parsed.options,
  });

  if (outcome.status === "refused") return refusalFiles(refusalsPath, outcome.refusals);

  return new Map([["openapi-merge/merged.yaml", outcome.text]]);
}
