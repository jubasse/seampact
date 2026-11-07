import type { Stats } from "node:fs";
import { lstat, readFile } from "node:fs/promises";

// Reads a file, or undefined when it does not exist; any other error is thrown.
export async function readFileIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;

    throw error;
  }
}

// The entry itself, never what a symbolic link points at, or undefined when nothing is there.
export async function lstatIfPresent(filePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
