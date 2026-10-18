import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { finalizeSerializeJson } from "@seampact/compiler";
import { EXIT_REFUSED, EXIT_SUCCESS, type CliIo, printProblems } from "../cli-io.js";
import type { CliProblem } from "../cli-problem.js";
import { readAppConfig } from "../config/index.js";
import { usedSources } from "./api-refs.js";
import type { CompiledApi } from "./compile-sources.js";
import { compileSources } from "./compile-sources.js";
import type { ConfigLocation } from "./config-location.js";

const IR_FILE_SUFFIX = ".ir.json";

// `seampact compile`: compiles the sources the app config's targets use and prints the compiler's diagnostics;
// with `--out <dir>`, writes each api's IR as `<api>.ir.json`, byte for byte the finalize output.
export async function compileCommand(
  location: ConfigLocation,
  irOutDir: string | undefined,
  io: CliIo,
): Promise<number> {
  const read = await readAppConfig(location.file, location.displayName);

  if (read.status === "refused") return refuse(io, read.problems);

  const used = usedSources(read.config);

  if (used.status === "refused") return refuse(io, used.problems);

  const compiled = compileSources(read.config.sources, used.names, io);

  if (compiled.failed) return refuse(io, compiled.problems);

  if (irOutDir === undefined) {
    io.stdout(`Compiled ${compiled.apis.length} api(s) without error.\n`);

    return EXIT_SUCCESS;
  }

  const collisions = sameNameProblems(compiled.apis);

  if (collisions.length > 0) return refuse(io, collisions);

  const directory = resolve(io.cwd, irOutDir);

  await mkdir(directory, { recursive: true });

  for (const { api, ir } of compiled.apis) {
    await writeFile(join(directory, `${api}${IR_FILE_SUFFIX}`), finalizeSerializeJson(ir));
  }

  io.stdout(`Wrote ${compiled.apis.length} IR file(s) to ${directory}.\n`);

  return EXIT_SUCCESS;
}

// Two sources holding an api of the same name would write the same `<api>.ir.json`.
function sameNameProblems(apis: readonly CompiledApi[]): CliProblem[] {
  return apis
    .filter((each, index) => apis.findIndex((other) => other.api === each.api) !== index)
    .map((each) => ({
      code: "compile.out.collision",
      message: `Several sources hold an api '${each.api}', and each would be written to ${each.api}${IR_FILE_SUFFIX}.`,
      fix: "Compile without `--out`, or keep one source holding that api in the app config.",
    }));
}

function refuse(io: CliIo, problems: readonly CliProblem[]): number {
  printProblems(io, problems);

  return EXIT_REFUSED;
}
