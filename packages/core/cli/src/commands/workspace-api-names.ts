import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { isRecord } from "../is-record.js";

export const WORKSPACE_ENTRY = "workspace.yaml";

// A workspace with a single api may omit `workspace.yaml` (grammar section 1): its api file is then this one.
export const SINGLE_API_ENTRY = "api.yaml";

// The entry file a `path` source compiles from: `workspace.yaml`, else the single api file; undefined when the
// directory holds neither.
export function sourceEntryFile(directory: string): string | undefined {
  return [WORKSPACE_ENTRY, SINGLE_API_ENTRY].find((entry) => existsSync(join(directory, entry)));
}

// The api names a `path` source holds, read without compiling the source: the `workspace.apis` of its
// `workspace.yaml`, or the `api.name` of its single api file. Undefined when the file cannot be read or parsed, or
// does not name them: the source is then compiled, and the compiler's diagnostic says what is wrong with it.
export async function workspaceApiNames(directory: string): Promise<string[] | undefined> {
  const entry = sourceEntryFile(directory);

  if (entry === undefined) return undefined;

  const text = await readFile(join(directory, entry), "utf8").catch(() => undefined);

  if (text === undefined) return undefined;

  const value: unknown = parseOrUndefined(text);

  if (entry === SINGLE_API_ENTRY) return singleApiName(value);

  const workspace = isRecord(value) ? value.workspace : undefined;
  const apis = isRecord(workspace) ? workspace.apis : undefined;

  return isRecord(apis) ? Object.keys(apis) : undefined;
}

function singleApiName(value: unknown): string[] | undefined {
  const api = isRecord(value) ? value.api : undefined;
  const name = isRecord(api) ? api.name : undefined;

  return typeof name === "string" ? [name] : undefined;
}

function parseOrUndefined(text: string): unknown {
  try {
    return parse(text);
  } catch {
    return undefined;
  }
}
