import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstatIfPresent } from "./file-presence.js";
import { checkGeneratedPaths, MANIFEST_FILE_NAME } from "./generated-paths.js";
import { readManifest, serializeManifest } from "./manifest.js";
import { type Refusal, type Refused, refused } from "./refusal.js";
import type { GeneratedFile } from "./target.js";

const BYTE_ORDER_MARK = "﻿";

const HAND_EDIT_FIX =
  "Move the hand-written code next to the generated files, then delete the edited file and generate again, or run `seampact generate --force` to overwrite it.";

export interface WrittenFiles {
  status: "written";
  written: string[];
  unchanged: string[];
  removed: string[];
}

export type WriteOutcome = WrittenFiles | Refused;

// A write whose checks all passed, not yet done: what `commitGeneratedWrite` writes, keeps and removes.
export interface PlannedWrite {
  readonly rootDir: string;
  readonly owner: string;
  readonly files: readonly PlannedFile[];
  readonly unchanged: readonly string[];
  readonly removable: readonly string[];
}

// What the writer does with a generated file that was edited by hand since it was written: refuse the whole
// write (the default), or write over it.
export type HandEditPolicy = "refuse" | "overwrite";

export interface PlanWriteOptions {
  readonly onHandEdit: HandEditPolicy;
}

const REFUSE_HAND_EDITS: PlanWriteOptions = { onHandEdit: "refuse" };

export type PlanWriteOutcome = { status: "planned"; write: PlannedWrite } | Refused;

interface PlannedFile {
  path: string;
  bytes: Buffer;
  sha256: string;
}

// Writes a target's files into its output directory (ADR 0015 "Writing files"): UTF-8 without a byte-order mark,
// LF line endings and a final newline, only inside `outDir`, with `.seampact-manifest.json` listing each file and
// its SHA-256. Files a previous run generated and this one does not are removed. Every check runs before the
// first write: a manifest that is not a regular file or belongs to another target, a file the writer did not generate, a hand-edited one or a path leaving `outDir` refuses the
// whole write, naming the file and the fix.
export async function writeGeneratedFiles(
  outDir: string,
  owner: string,
  files: readonly GeneratedFile[],
  options: PlanWriteOptions = REFUSE_HAND_EDITS,
): Promise<WriteOutcome> {
  const planned = await planGeneratedWrite(outDir, owner, files, options);

  if (planned.status === "refused") return planned;

  return commitGeneratedWrite(planned.write);
}

// Every check of `writeGeneratedFiles`, with nothing written, so a caller writing
// several directories checks them all before the first write.
export async function planGeneratedWrite(
  outDir: string,
  owner: string,
  files: readonly GeneratedFile[],
  options: PlanWriteOptions = REFUSE_HAND_EDITS,
): Promise<PlanWriteOutcome> {
  const checked = checkGeneratedPaths(files);

  if (checked.status === "refused") return checked;

  const rootDir = await realpathOfMissing(resolve(outDir));
  const manifestRefusal = await manifestFileRefusal(rootDir);

  if (manifestRefusal !== undefined) return refused([manifestRefusal]);

  const manifest = await readManifest(rootDir);

  if (manifest.status === "invalid") {
    return refused([
      {
        code: "writer.manifest.invalid",
        message: `The manifest ${join(rootDir, MANIFEST_FILE_NAME)} cannot be read: ${manifest.reason}.`,
        fix: "Delete the generated files of this target and its manifest, then generate again.",
      },
    ]);
  }

  if (manifest.owner !== undefined && manifest.owner !== owner) {
    return refused([
      {
        code: "writer.manifest.other-owner",
        message: `The output directory ${rootDir} belongs to the target '${manifest.owner}', not '${owner}'.`,
        fix: `Give '${owner}' its own \`out\` directory, or delete ${join(rootDir, MANIFEST_FILE_NAME)} and the files of '${manifest.owner}'.`,
      },
    ]);
  }

  const planned = checked.files.map(planFile);
  const producedPaths = new Set(planned.map((file) => file.path));
  const stalePaths = [...manifest.hashByPath.keys()].filter((path) => !producedPaths.has(path));
  const refusals: Refusal[] = [];
  const unchanged: string[] = [];
  const removable: string[] = [];

  for (const file of planned) {
    const state = await existingFileState(
      rootDir,
      file.path,
      manifest.hashByPath.get(file.path),
      options,
    );

    if (state.status === "refused") refusals.push(state.refusal);

    if (state.status === "generated" && state.sha256 === file.sha256) unchanged.push(file.path);
  }

  for (const path of stalePaths) {
    const state = await existingFileState(rootDir, path, manifest.hashByPath.get(path), options);

    if (state.status === "refused") refusals.push(state.refusal);

    if (state.status === "generated") removable.push(path);
  }

  if (refusals.length > 0) return refused(refusals);

  return { status: "planned", write: { rootDir, owner, files: planned, unchanged, removable } };
}

// Writes a planned write: the changed files, the removal of the stale ones, then the manifest.
export async function commitGeneratedWrite(write: PlannedWrite): Promise<WrittenFiles> {
  const { rootDir, owner, files: planned, unchanged, removable } = write;

  await mkdir(rootDir, { recursive: true });

  const unchangedPaths = new Set(unchanged);
  const toWrite = planned.filter((file) => !unchangedPaths.has(file.path));

  for (const file of toWrite) {
    const filePath = join(rootDir, file.path);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.bytes);
  }

  for (const path of removable) {
    await unlink(join(rootDir, path));
    await removeEmptyDirectories(rootDir, dirname(join(rootDir, path)));
  }

  const hashByPath = new Map(planned.map((file) => [file.path, file.sha256]));

  await writeFile(join(rootDir, MANIFEST_FILE_NAME), serializeManifest(owner, hashByPath), "utf8");

  return {
    status: "written",
    written: toWrite.map((file) => file.path),
    unchanged: [...unchanged],
    removed: [...removable],
  };
}

// The real path `directory` has or will have once created: its deepest existing ancestor's real path, then the
// rest of it, so planning a write creates nothing.
async function realpathOfMissing(directory: string): Promise<string> {
  if ((await lstatIfPresent(directory)) !== undefined) return realpath(directory);

  const parent = dirname(directory);

  if (parent === directory) return directory;

  return join(await realpathOfMissing(parent), basename(directory));
}

// The manifest is the writer's own file: a link or a directory in its place is never read or written through.
async function manifestFileRefusal(rootDir: string): Promise<Refusal | undefined> {
  const manifestPath = join(rootDir, MANIFEST_FILE_NAME);
  const stats = await lstatIfPresent(manifestPath);

  if (stats === undefined || stats.isFile()) return undefined;

  return {
    code: "writer.manifest.not-regular",
    message: `The manifest ${manifestPath} is not a regular file, so the writer does not read or write it.`,
    fix: `Delete ${manifestPath}, then generate again.`,
  };
}

function planFile(file: GeneratedFile): PlannedFile {
  const withoutMark = file.contents.startsWith(BYTE_ORDER_MARK)
    ? file.contents.slice(1)
    : file.contents;
  const lineFeeds = withoutMark.replace(/\r\n?/g, "\n");
  const text = lineFeeds.endsWith("\n") ? lineFeeds : `${lineFeeds}\n`;
  const bytes = Buffer.from(text, "utf8");

  return { path: file.path, bytes, sha256: sha256Of(bytes) };
}

type ExistingFileState =
  | { status: "absent" }
  | { status: "generated"; sha256: string }
  | { status: "refused"; refusal: Refusal };

// What is at `path` now: nothing, the file the manifest recorded, or something the writer must not touch.
async function existingFileState(
  rootDir: string,
  path: string,
  recordedSha256: string | undefined,
  options: PlanWriteOptions,
): Promise<ExistingFileState> {
  const filePath = join(rootDir, path);

  if (await leavesRoot(rootDir, filePath)) {
    return refusedState(
      "writer.path.outside",
      `'${filePath}' resolves outside the output directory ${rootDir} through a symbolic link.`,
      "Replace the symbolic link in the output directory with a plain directory.",
    );
  }

  const stats = await lstatIfPresent(filePath);

  if (stats === undefined) return { status: "absent" };

  if (!stats.isFile()) {
    return refusedState(
      "writer.file.not-generated",
      `'${filePath}' is not a regular file, so the writer did not generate it.`,
      `Move it out of the output directory ${rootDir}.`,
    );
  }

  if (recordedSha256 === undefined) {
    return refusedState(
      "writer.file.not-generated",
      `'${filePath}' exists and the writer did not generate it, so it is not overwritten.`,
      `Move it out of the output directory ${rootDir}, or rename it.`,
    );
  }

  const sha256 = sha256Of(await readFile(filePath));

  if (sha256 !== recordedSha256 && options.onHandEdit === "refuse") {
    return refusedState(
      "writer.file.edited",
      `'${filePath}' was edited by hand since it was generated, so it is not overwritten or removed.`,
      HAND_EDIT_FIX,
    );
  }

  return { status: "generated", sha256 };
}

function refusedState(code: string, message: string, fix: string): ExistingFileState {
  return { status: "refused", refusal: { code, message, fix } };
}

// True when the deepest existing directory above `filePath` is, once symbolic links resolve, outside `rootDir`.
async function leavesRoot(rootDir: string, filePath: string): Promise<boolean> {
  let directory = dirname(filePath);

  while ((await lstatIfPresent(directory)) === undefined) {
    // The output directory itself is not created yet, so nothing below it is a link.
    if (directory === rootDir) return false;

    directory = dirname(directory);
  }

  return isOutside(rootDir, await realpath(directory));
}

function isOutside(rootDir: string, path: string): boolean {
  const fromRoot = relative(rootDir, path);

  return fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
}

async function removeEmptyDirectories(rootDir: string, directory: string): Promise<void> {
  if (directory === rootDir || isOutside(rootDir, directory)) return;

  if ((await readdir(directory)).length > 0) return;

  await rmdir(directory);
  await removeEmptyDirectories(rootDir, dirname(directory));
}

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
