import { apiIndexSource, type GenerateInput, type GenerateOutcome } from "@seampact/codegen-core";
import {
  CLIENT_ARTEFACT,
  type ClientArtefact,
  type FetchClientOptions,
  generateClient,
} from "@seampact/codegen-fetch";
import { AXIOS_MODULE, axiosModuleSource } from "./axios-module.js";

const INDEX_PATH = "index.ts";
const AXIOS_PATH = `${AXIOS_MODULE}.ts`;

// The fetch client's files, plus the adapter module and its export from the index: the fetch client refuses what it
// refuses, and the axios one with it.
export function generateAxiosClient(
  input: GenerateInput<FetchClientOptions, ClientArtefact, "types">,
): GenerateOutcome {
  const outcome = generateClient(input);

  if (outcome.status !== "generated" || !input.artefacts.has(CLIENT_ARTEFACT)) return outcome;

  const adapterExport = apiIndexSource([
    { module: AXIOS_MODULE, typeNames: [], valueNames: ["fetchOfAxios"] },
  ]);
  const files = outcome.files.map((file) =>
    file.path === INDEX_PATH ? { ...file, contents: `${file.contents}${adapterExport}` } : file,
  );

  return {
    status: "generated",
    files: [...files, { path: AXIOS_PATH, contents: axiosModuleSource() }],
  };
}
