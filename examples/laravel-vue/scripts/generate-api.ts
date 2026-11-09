// Generates the Laravel app's code from the contract. The Composer runner reads a bundle, so this packs the contract
// with the seampact CLI into a local git repository, pins it in api/seampact.config.yaml, then runs `seampact generate`
// in api/. A real app pins a published bundle instead: see docs/features/sharing-contracts.md.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exampleDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = join(exampleDirectory, "api");
const contractRepository = join(exampleDirectory, ".contract-repo");
const contractTag = "v1.0.0";
const seampactCli = join(exampleDirectory, "node_modules/@seampact/cli/src/bin.ts");

function run(command: string, args: string[], directory: string): string {
  return execFileSync(command, args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function bundleContract(): string {
  rmSync(contractRepository, { recursive: true, force: true });
  mkdirSync(contractRepository);

  const printed = run(
    process.execPath,
    [
      "--import",
      "tsx",
      seampactCli,
      "bundle",
      "--out",
      join(contractRepository, "bundle"),
      "--name",
      "@seampact/notes",
      "--version",
      "1.0.0",
    ],
    exampleDirectory,
  );
  const integrity = /^integrity: (.+)$/m.exec(printed)?.[1];

  if (integrity === undefined) throw new Error(`seampact bundle printed no integrity:\n${printed}`);

  const git = (...args: string[]) =>
    run(
      "git",
      ["-c", "user.name=seampact", "-c", "user.email=seampact@localhost", ...args],
      contractRepository,
    );

  git("init", "-q");
  git("add", "bundle");
  git("commit", "-qm", "Bundle the notes contract.");
  git("tag", contractTag);

  return integrity;
}

function writeApiConfig(integrity: string): void {
  const template = readFileSync(join(apiDirectory, "seampact.config.template.yaml"), "utf8");
  const config = template
    .replaceAll("{{CONTRACT_REPOSITORY}}", contractRepository)
    .replaceAll("{{CONTRACT_TAG}}", contractTag)
    .replaceAll("{{CONTRACT_INTEGRITY}}", integrity);

  writeFileSync(join(apiDirectory, "seampact.config.yaml"), config);
}

writeApiConfig(bundleContract());
execFileSync("php", ["vendor/bin/seampact", "generate"], { cwd: apiDirectory, stdio: "inherit" });
