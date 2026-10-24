import { lstat } from "node:fs/promises";
import { errorCode } from "./error-code.js";

/** Whether `path` is a symbolic link, dangling or not; false when nothing is there. */
export async function isSymbolicLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;

    throw error;
  }
}

/** Whether anything is at `path`, a dangling symbolic link included. */
export async function isPathTaken(path: string): Promise<boolean> {
  try {
    await lstat(path);

    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;

    throw error;
  }
}
