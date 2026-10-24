import { mkdir, realpath, rename, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { type LoadReader, loadWorkspace } from "@seampact/compiler";
import type { CliProblem } from "../cli-problem.js";
import { isStrictlyInside } from "../config/path-containment.js";
import { isSymbolicLink } from "../symbolic-link.js";
import { type EditorDeclaration, editorNames } from "./editor-names.js";
import { type EditorSchemaFile, editorSchemaFiles } from "./specialise.js";

/** Where `compile --editor-schemas` writes when `workspace.editorSchemas` names nothing (grammar section 1). */
export const DEFAULT_EDITOR_SCHEMAS_DIRECTORY = ".seampact/schemas";

const TEMPORARY_SUFFIX = ".tmp";

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

/** A checked write: the directory is inside the workspace root by real path, and no target file is a symlink. */
export interface EditorSchemasPlan {
  readonly directory: string;
  readonly files: readonly EditorSchemaFile[];
}

export type EditorSchemasPlanOutcome =
  | { readonly status: "planned"; readonly plan: EditorSchemasPlan }
  | { readonly status: "refused"; readonly problem: CliProblem };

/** Checks where the workspace's editor schemas go (`workspace.editorSchemas`, under its root) and writes nothing. */
export async function planEditorSchemas(
  source: EditorSchemasSource,
): Promise<EditorSchemasPlanOutcome> {
  const configured =
    loadWorkspace({ reader: source.reader, entry: source.entry }).workspace.config?.editorSchemas ??
    DEFAULT_EDITOR_SCHEMAS_DIRECTORY;
  const directory = resolve(source.directory, configured);

  if (isAbsolute(configured) || !isStrictlyInside(resolve(source.directory), directory))
    return refused(
      source,
      `workspace.editorSchemas names '${configured}', which is not a directory inside the workspace root ${source.directory}.`,
    );

  const real = await realTargetDirectory(directory);

  if (real === undefined || !isStrictlyInside(await realpath(source.directory), real))
    return refused(
      source,
      `workspace.editorSchemas names '${configured}', which resolves through a symbolic link to a place outside the workspace root ${source.directory}.`,
    );

  const files = editorSchemaFiles(editorNames(source.declarations));

  for (const file of files) {
    if (await isSymbolicLink(join(directory, file.fileName)))
      return refused(
        source,
        `The editor schema ${join(directory, file.fileName)} is a symbolic link, and writing it would overwrite its target.`,
      );
  }

  return { status: "planned", plan: { directory, files } };
}

/** Writes a checked plan: each file goes to a temporary file, then replaces its target by a rename. */
export async function writeEditorSchemas(plan: EditorSchemasPlan): Promise<number> {
  await mkdir(plan.directory, { recursive: true });

  for (const file of plan.files) {
    const target = join(plan.directory, file.fileName);
    const temporary = `${target}${TEMPORARY_SUFFIX}`;

    await writeFile(temporary, file.text);
    await rename(temporary, target);
  }

  return plan.files.length;
}

// The real path the directory would have once created: the real path of its nearest existing ancestor, then the
// segments that do not exist yet. Undefined when a segment is a dangling symbolic link.
async function realTargetDirectory(directory: string): Promise<string | undefined> {
  const missing: string[] = [];
  let existing = directory;

  for (;;) {
    try {
      return join(await realpath(existing), ...missing);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    if (await isSymbolicLink(existing)) return undefined;

    const parent = resolve(existing, "..");

    if (parent === existing) return undefined;

    missing.unshift(basename(existing));
    existing = parent;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function refused(source: EditorSchemasSource, message: string): EditorSchemasPlanOutcome {
  return {
    status: "refused",
    problem: {
      code: "compile.editor-schemas.outside",
      message,
      fix: `Name a relative directory below the workspace root with no symbolic link in it, such as ${DEFAULT_EDITOR_SCHEMAS_DIRECTORY}, or remove workspace.editorSchemas.`,
      where: `source '${source.name}', ${source.entry}`,
    },
  };
}
