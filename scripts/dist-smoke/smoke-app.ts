import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "../golden/repo-root.ts";

// An app of the smoke tests: a directory with its `seampact.config.yaml`, generating the reference apis' types
// with `@seampact/codegen-ts` linked from the repository.

const CODEGEN_TS = join(REPO_ROOT, "packages/targets/codegen-ts");
const CONFIG_FILE = "seampact.config.yaml";

export const GENERATED_DIRECTORY = "__generated__";

/** The config of an app whose one source `contract` is `source`, a YAML flow mapping. */
export function smokeConfig(source: string): string {
  return `sources:
  contract: ${source}
targets:
  - { id: tasks, use: "@seampact/codegen-ts", api: tasks }
  - { id: service, use: "@seampact/codegen-ts", api: tasksService }
`;
}

/** Creates the app directory (when new), links the target and writes the config. */
export function writeSmokeApp(directory: string, config: string): void {
  const target = join(directory, "node_modules", "@seampact", "codegen-ts");

  mkdirSync(join(target, ".."), { recursive: true });

  if (!readdirSync(join(target, "..")).includes("codegen-ts"))
    symlinkSync(CODEGEN_TS, target, "junction");

  writeFileSync(join(directory, CONFIG_FILE), config);
}

/** Every generated file's text by its path under the output directory. */
export function generatedFiles(appDirectory: string): Map<string, string> {
  const root = join(appDirectory, GENERATED_DIRECTORY);
  const files = new Map<string, string>();
  const pending = [root];

  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) pending.push(path);
      else files.set(relative(root, path).split("\\").join("/"), readFileSync(path, "utf8"));
    }
  }

  return new Map([...files].sort(([left], [right]) => (left < right ? -1 : 1)));
}
