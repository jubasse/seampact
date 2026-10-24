import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { finalizeSerializeJson, loadFsReader } from "@seampact/compiler";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems } from "../cli-io.js";
import type { CliProblem } from "../cli-problem.js";
import { type LoadedAppConfig, openApiApiNames, readAppConfig } from "../config/index.js";
import {
  type EditorSchemasPlan,
  planEditorSchemas,
  writeEditorSchemas,
} from "../editor-schemas/index.js";
import { addQualifyFix, entryApiRefs, usedSources } from "./api-refs.js";
import type { CompiledApi } from "./compile-sources.js";
import { compileSources } from "./compile-sources.js";
import type { ConfigLocation } from "./config-location.js";
import { sourceEntryFile } from "./workspace-api-names.js";

const IR_FILE_SUFFIX = ".ir.json";

/** Whether `compile` writes the workspace's editor schemas besides compiling (`--editor-schemas`). */
export type EditorSchemasMode = "write" | "skip";

export interface CompileOutputs {
  /** `--out <dir>`: where each api's IR is written. */
  readonly irOutDir: string | undefined;
  readonly editorSchemas: EditorSchemasMode;
}

// `seampact compile`: compiles the sources the app config's targets use and prints the compiler's diagnostics;
// with `--out <dir>`, writes each api's IR as `<api>.ir.json`, byte for byte the finalize output; with
// `--editor-schemas`, writes each `path` source's editor schemas (grammar section 3). A compile error writes nothing.
export async function compileCommand(
  location: ConfigLocation,
  outputs: CompileOutputs,
  io: CliIo,
): Promise<number> {
  const read = await readAppConfig(location.file, location.displayName);

  if (read.status === "refused") return refuse(io, read.problems);

  const extraRefs = openApiApiNames(read.config);
  const used = await usedSources(read.config, extraRefs);

  if (used.status === "refused") return refuse(io, used.problems);

  const compiled = await compileSources(read.config, used.names, io);

  if (compiled.failed) {
    return refuse(
      io,
      addQualifyFix(compiled.problems, [...entryApiRefs(read.config), ...extraRefs]),
    );
  }

  if (outputs.irOutDir === undefined && outputs.editorSchemas === "skip") {
    io.stdout(`Compiled ${compiled.apis.length} api(s) without error.\n`);

    return EXIT_SUCCESS;
  }

  const collisions = outputs.irOutDir === undefined ? [] : sameNameProblems(compiled.apis);

  if (collisions.length > 0) return refuse(io, collisions);

  // Every refusal comes before the first write.
  const planned =
    outputs.editorSchemas === "write"
      ? await planSourcesEditorSchemas(read.config, used.names, compiled.apis, io)
      : { problems: [], plans: [] };

  if (planned.problems.length > 0) return refuse(io, planned.problems);

  if (outputs.irOutDir !== undefined)
    await writeIrFiles(compiled.apis, resolve(io.cwd, outputs.irOutDir), io);

  for (const { name, plan } of planned.plans) {
    const fileCount = await writeEditorSchemas(plan);

    io.stdout(`Wrote ${fileCount} editor schema(s) of source '${name}' to ${plan.directory}.\n`);
  }

  return EXIT_SUCCESS;
}

async function writeIrFiles(
  apis: readonly CompiledApi[],
  directory: string,
  io: CliIo,
): Promise<void> {
  await mkdir(directory, { recursive: true });

  for (const { api, ir } of apis) {
    await writeFile(join(directory, `${api}${IR_FILE_SUFFIX}`), finalizeSerializeJson(ir));
  }

  io.stdout(`Wrote ${apis.length} IR file(s) to ${directory}.\n`);
}

export interface PlannedEditorSchemas {
  readonly problems: CliProblem[];
  readonly plans: { readonly name: string; readonly plan: EditorSchemasPlan }[];
}

// Each `path` source gets the editor schemas of its workspace; a bundle source holds no file anyone edits.
export async function planSourcesEditorSchemas(
  config: Pick<LoadedAppConfig, "sources">,
  names: readonly string[],
  apis: readonly CompiledApi[],
  io: CliIo,
): Promise<PlannedEditorSchemas> {
  const planned: PlannedEditorSchemas = { problems: [], plans: [] };

  for (const name of names) {
    const source = config.sources.get(name);

    if (source === undefined) throw new Error(`no source named ${name} in the app config`);

    if (source.kind === "bundle") {
      io.stdout(`Source '${name}' is a bundle, whose files are not edited: no editor schemas.\n`);
      continue;
    }

    const entry = sourceEntryFile(source.directory);

    // compileSources refused a directory without an entry file already.
    if (entry === undefined) throw new Error(`the source ${name} has no entry file`);

    const outcome = await planEditorSchemas({
      name,
      directory: source.directory,
      entry,
      reader: (io.sourceReader ?? loadFsReader)(source.directory),
      declarations: apis
        .filter((api) => api.source === name)
        .flatMap((api) => api.editorDeclarations?.() ?? []),
    });

    if (outcome.status === "refused") planned.problems.push(outcome.problem);
    else planned.plans.push({ name, plan: outcome.plan });
  }

  return planned;
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
