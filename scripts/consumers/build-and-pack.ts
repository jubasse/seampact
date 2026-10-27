import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILD_CONFIG,
  BUILD_DIRECTORY,
  COMMONJS_BUILD_CONFIG,
  COMMONJS_BUILD_DIRECTORY,
  PACKED_PACKAGES,
  PACKED_PACKS,
} from "./packed-packages.ts";
import { runStep, type StepOutput } from "./run-step.ts";

const TYPESCRIPT_COMPILER = "node_modules/.bin/tsc";
const TARBALL_SUFFIX = ".tgz";
const COMMONJS_MARKER = `${JSON.stringify({ type: "commonjs" })}\n`;

// Builds each packed package from a clean `dist/`, and its CommonJS build when it ships one.
export function buildPackages(repositoryRoot: string, output: StepOutput = "inherit"): void {
  for (const directory of PACKED_PACKAGES) {
    const packageRoot = join(repositoryRoot, directory);

    rmSync(join(packageRoot, BUILD_DIRECTORY), { recursive: true, force: true });
    runStep({
      title: `build ${directory}`,
      output,
      command: join(repositoryRoot, TYPESCRIPT_COMPILER),
      args: ["-p", BUILD_CONFIG],
      cwd: packageRoot,
    });

    if (existsSync(join(packageRoot, COMMONJS_BUILD_CONFIG))) {
      buildCommonJs(repositoryRoot, directory, output);
    }
  }
}

function buildCommonJs(repositoryRoot: string, directory: string, output: StepOutput): void {
  const packageRoot = join(repositoryRoot, directory);

  runStep({
    title: `build ${directory} (CommonJS)`,
    output,
    command: join(repositoryRoot, TYPESCRIPT_COMPILER),
    args: ["-p", COMMONJS_BUILD_CONFIG],
    cwd: packageRoot,
  });
  writeFileSync(join(packageRoot, COMMONJS_BUILD_DIRECTORY, "package.json"), COMMONJS_MARKER);
}

// Packs each package and each convention pack into `destination` and answers the tarball file names, by package name.
export function packPackages(
  repositoryRoot: string,
  destination: string,
  output: StepOutput = "inherit",
): Map<string, string> {
  rmSync(destination, { recursive: true, force: true });

  for (const directory of [...PACKED_PACKAGES, ...PACKED_PACKS]) {
    runStep({
      title: `pack ${directory}`,
      output,
      command: "pnpm",
      args: ["pack", "--silent", "--pack-destination", destination],
      cwd: join(repositoryRoot, directory),
    });
  }

  return new Map(
    readdirSync(destination)
      .filter((file) => file.endsWith(TARBALL_SUFFIX))
      .sort()
      .map((file) => [packageNameOf(file), file]),
  );
}

// `seampact-codegen-fetch-0.0.0.tgz` is `@seampact/codegen-fetch`.
function packageNameOf(tarball: string): string {
  const match = /^seampact-(.+)-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.tgz$/.exec(tarball);

  if (match === null)
    throw new Error(`consumers: '${tarball}' is not a packed @seampact tarball name`);

  return `@seampact/${match[1]}`;
}
