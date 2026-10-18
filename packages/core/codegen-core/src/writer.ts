import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstatIfPresent } from "./file-presence.js";
import { checkGeneratedPaths, MANIFEST_FILE_NAME } from "./generated-paths.js";
import { readManifest, serializeManifest } from "./manifest.js";
import { type Refusal, type Refused, refused } from "./refusal.js";
import type { GeneratedFile } from "./target.js";

const BYTE_ORDER_MARK = "﻿";

const HAND_EDIT_FIX =
  "Move the hand-written code next to the generated files, then delete the edited file and generate again.";

export type WriteOutcome =
  | { status: "written"; written: string[]; unchanged: string[]; removed: string[] }
  | Refused;

interface PlannedFile {
  path: string;
  bytes: Buffer;
  sha256: string;
}

// Writes a target's files into its output directory (ADR 0015 "Writing files"): UTF-8 without a byte-order mark,
// LF line endings and a final newline, only inside `outDir`, with `.seampact-manifest.json` listing each file and
// its SHA-256. Files a previous run generated and this one does not are removed. Every check runs before the
// first write: a file the writer did not generate, a hand-edited one or a path leaving `outDir` refuses the
// whole write, naming the file and the fix.
export async function writeGeneratedFiles(
  outDir: string,
  files: readonly GeneratedFile[],
): Promise<WriteOutcome> {
  const checked = checkGeneratedPaths(files);

  if (checked.status === "refused") return checked;

  await mkdir(resolve(outDir), { recursive: true });

  const rootDir = await realpath(resolve(outDir));
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

  const planned = checked.files.map(planFile);
  const producedPaths = new Set(planned.map((file) => file.path));
  const stalePaths = [...manifest.hashByPath.keys()].filter((path) => !producedPaths.has(path));
  const refusals: Refusal[] = [];
  const unchanged: string[] = [];
  const removable: string[] = [];

  for (const file of planned) {
    const state = await existingFileState(rootDir, file.path, manifest.hashByPath.get(file.path));

    if (state.status === "refused") refusals.push(state.refusal);

    if (state.status === "generated" && state.sha256 === file.sha256) unchanged.push(file.path);
  }

  for (const path of stalePaths) {
    const state = await existingFileState(rootDir, path, manifest.hashByPath.get(path));

    if (state.status === "refused") refusals.push(state.refusal);

    if (state.status === "generated") removable.push(path);
  }

  if (refusals.length > 0) return refused(refusals);

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

  await writeFile(join(rootDir, MANIFEST_FILE_NAME), serializeManifest(hashByPath), "utf8");

  return {
    status: "written",
    written: toWrite.map((file) => file.path),
    unchanged,
    removed: removable,
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

  if (sha256 !== recordedSha256) {
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

  while ((await lstatIfPresent(directory)) === undefined) directory = dirname(directory);

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
