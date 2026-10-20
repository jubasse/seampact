import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { isRecord } from "../is-record.js";

export const WORKSPACE_ENTRY = "workspace.yaml";

// The api names a `path` source's `workspace.yaml` maps under `workspace.apis`, read without compiling the source.
// Undefined when the file cannot be read or parsed, or does not map `workspace.apis`: the source is then compiled,
// and the compiler's diagnostic says what is wrong with it.
export async function workspaceApiNames(directory: string): Promise<string[] | undefined> {
  const text = await readFile(join(directory, WORKSPACE_ENTRY), "utf8").catch(() => undefined);

  if (text === undefined) return undefined;

  const value: unknown = parseOrUndefined(text);
  const workspace = isRecord(value) ? value.workspace : undefined;
  const apis = isRecord(workspace) ? workspace.apis : undefined;

  return isRecord(apis) ? Object.keys(apis) : undefined;
}

function parseOrUndefined(text: string): unknown {
  try {
    return parse(text);
  } catch {
    return undefined;
  }
}
