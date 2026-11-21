import type { OracleApiResult } from "./compiler.ts";
import { type ExpectedFiles, jsonText } from "./expected-text.ts";
import type { OracleTools } from "./tool-modules.ts";

// `lint/<api>.json`: what `runLint` reports for each api that compiled, written only when it reports something.
// `declared` and `locations` come from the compilation, as the CLI passes them, with no plugin.

export async function lintFiles(
  tools: OracleTools,
  apis: readonly OracleApiResult[],
): Promise<ExpectedFiles> {
  const files: ExpectedFiles = new Map();

  for (const { api, lintInput } of apis) {
    if (lintInput === undefined) continue;

    const diagnostics = await tools.runLint({ ...lintInput, plugins: [] });

    if (diagnostics.length > 0) files.set(`lint/${api}.json`, jsonText(diagnostics));
  }

  return files;
}
