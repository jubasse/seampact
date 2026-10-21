import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { type LoadReader, loadWorkspace } from "@seampact/compiler";
import type { CliProblem } from "../cli-problem.js";
import { isStrictlyInside } from "../config/path-containment.js";
import { type EditorDeclaration, editorNames } from "./editor-names.js";
import { editorSchemaFiles } from "./specialise.js";

/** Where `compile --editor-schemas` writes when `workspace.editorSchemas` names nothing (grammar section 1). */
export const DEFAULT_EDITOR_SCHEMAS_DIRECTORY = ".seampact/schemas";

export interface EditorSchemasSource {
  readonly name: string;
  /** The contract workspace's root. */
  readonly directory: string;
  /** Root-relative entry file: `workspace.yaml`, or the single api file. */
  readonly entry: string;
  readonly reader: LoadReader;
  /** What every api of the workspace declares. */
  readonly declarations: readonly EditorDeclaration[];
}

export type EditorSchemasOutcome =
  | { readonly status: "written"; readonly directory: string; readonly fileCount: number }
  | { readonly status: "refused"; readonly problem: CliProblem };

/** Writes the workspace's editor schemas to the directory `workspace.editorSchemas` names, under its root. */
export async function writeEditorSchemas(
  source: EditorSchemasSource,
): Promise<EditorSchemasOutcome> {
  const configured =
    loadWorkspace({ reader: source.reader, entry: source.entry }).workspace.config?.editorSchemas ??
    DEFAULT_EDITOR_SCHEMAS_DIRECTORY;
  const directory = resolve(source.directory, configured);

  if (isAbsolute(configured) || !isStrictlyInside(resolve(source.directory), directory))
    return { status: "refused", problem: outsideProblem(source, configured) };

  const files = editorSchemaFiles(editorNames(source.declarations));

  await mkdir(directory, { recursive: true });

  for (const file of files) await writeFile(join(directory, file.fileName), file.text);

  return { status: "written", directory, fileCount: files.length };
}

function outsideProblem(source: EditorSchemasSource, configured: string): CliProblem {
  return {
    code: "compile.editor-schemas.outside",
    message: `workspace.editorSchemas names '${configured}', which is not a directory inside the workspace root ${source.directory}.`,
    fix: `Name a relative directory below the workspace root, such as ${DEFAULT_EDITOR_SCHEMAS_DIRECTORY}, or remove workspace.editorSchemas.`,
    where: `source '${source.name}', ${source.entry}`,
  };
}
