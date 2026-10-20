import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliIo } from "../cli-io.js";
import { runCli } from "../run-cli.js";

// Temporary apps for the command tests: a copy of the reference workspace per source, fake target packages in the
// app's `node_modules`, and an app config; removed by `removeTemporaryDirectories`.

export const REFERENCE_WORKSPACE = new URL("../../../../../fixtures/reference", import.meta.url)
  .pathname;

const temporaryDirectories: string[] = [];

export function trackTemporaryDirectory(directory: string): void {
  temporaryDirectories.push(directory);
}

export function removeTemporaryDirectories(): void {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
}

export interface FakeTarget {
  name: string;
  // The role the fake declares; a client when absent.
  role?: string;
  consumes?: string[];
  provides?: string[];
  packageJson?: string;
  // What the fake's `generate` returns as `warnings`.
  warnings?: object[];
  // The files the fake's `generate` returns.
  files?: { path: string; contents: string }[];
  // The artefacts the fake declares; none when absent.
  artefacts?: object[];
  // The fix the fake's metadata states for `frameworkDocs: off`.
  frameworkDocsOffFix?: string;
  // The fake's `generate` writes the document it receives for `nativeDocs` to `native-document.json`.
  echoNativeDocsDocument?: boolean;
}

// The JavaScript expression of the files the fake's `generate` returns.
function generatedFilesSource(target: FakeTarget): string {
  if (target.echoNativeDocsDocument !== true) return JSON.stringify(target.files ?? []);

  return `request.nativeDocsDocument === undefined ? [] : [{ path: "native-document.json", contents: JSON.stringify(request.nativeDocsDocument) }]`;
}

// A target package of plain CommonJS: the refusals below happen before `generate` is called.
function writeTargetPackage(appDirectory: string, target: FakeTarget): void {
  const directory = join(appDirectory, "node_modules", target.name);
  const kinds = (names: string[] = []) =>
    JSON.stringify(Object.fromEntries(names.map((kind) => [kind, { styles: [], style: "x" }])));

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    target.packageJson ?? JSON.stringify({ name: target.name, main: "index.cjs" }),
  );
  writeFileSync(
    join(directory, "index.cjs"),
    `exports.target = {
  metadata: {
    packageName: ${JSON.stringify(target.name)},
    packageVersion: "0.0.0",
    role: ${JSON.stringify(target.role ?? "client")},
    irSupport: {},
    artefacts: ${JSON.stringify(target.artefacts ?? [])},
    ${target.frameworkDocsOffFix === undefined ? "" : `frameworkDocsOffFix: ${JSON.stringify(target.frameworkDocsOffFix)},`}
    consumes: ${kinds(target.consumes)},
    provides: ${kinds(target.provides)},
  },
  parseOptions: (raw) => ({ status: "parsed", options: raw }),
  generate: async (request) => ({ status: "generated", files: ${generatedFilesSource(target)}, warnings: ${JSON.stringify(target.warnings ?? [])} }),
  describe: () => ({ status: "described", descriptors: {} }),
};\n`,
  );
}

export function makeApp(
  config: string,
  targets: FakeTarget[],
  sourceNames: string[] = ["a"],
): string {
  const appDirectory = mkdtempSync(join(tmpdir(), "seampact-cli-"));

  trackTemporaryDirectory(appDirectory);

  for (const name of sourceNames)
    cpSync(REFERENCE_WORKSPACE, join(appDirectory, name), { recursive: true });

  for (const target of targets) writeTargetPackage(appDirectory, target);

  writeFileSync(join(appDirectory, "seampact.config.yaml"), config);

  return appDirectory;
}

export async function generateErrors(
  appDirectory: string,
): Promise<{ exitCode: number; output: string }> {
  const errors: string[] = [];
  const io: CliIo = { cwd: appDirectory, stdout: () => {}, stderr: (text) => errors.push(text) };
  const exitCode = await runCli(["generate"], io);

  return { exitCode, output: errors.join("") };
}

export async function generateOutput(
  appDirectory: string,
): Promise<{ exitCode: number; output: string }> {
  const lines: string[] = [];
  const io: CliIo = {
    cwd: appDirectory,
    stdout: (text) => lines.push(text),
    stderr: (text) => lines.push(text),
  };
  const exitCode = await runCli(["generate"], io);

  return { exitCode, output: lines.join("") };
}
