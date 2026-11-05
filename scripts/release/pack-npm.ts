// Builds and packs every published npm package into one directory, then checks each tarball's contents; the
// directory is the artefact the binary embeds the packs from and the publish jobs upload.
//   node scripts/release/pack-npm.ts <version> --out <dir> [--root <dir>]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildPackages, packPackages } from "../consumers/build-and-pack.ts";
import { StepFailure } from "../consumers/run-step.ts";
import { PUBLISHED_PACKAGES } from "./npm-versions.ts";
import { packEntry } from "./pack-versions.ts";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "./release-cli.ts";
import { ReleaseError, releaseVersion } from "./release-version.ts";
import { type PackedPackage, tarballProblems } from "./tarball-contents.ts";

const USAGE = "node scripts/release/pack-npm.ts <version> --out <dir> [--root <dir>]";
const TARBALL_PACKAGE_DIRECTORY = "package/";

await runReleaseCommand("pack-npm", () => {
  const { values, positionals } = parsedArguments(
    { ...ROOT_OPTION, out: { type: "string" } },
    USAGE,
  );
  const root = repositoryRoot(values.root);
  const version = releaseVersion(positionals[0]);

  if (values.out === undefined) throw new ReleaseError(`--out is required; usage: ${USAGE}`);

  const out = resolve(values.out);
  const tarballByName = buildAndPack(root, out);
  const run: PackRun = { root, out, version, tarballByName };
  const problems = PUBLISHED_PACKAGES.flatMap((directory) => packageProblems(run, directory));

  if (problems.length > 0)
    throw new ReleaseError(
      `${problems.length} problem(s) in the tarballs:\n  ${problems.join("\n  ")}`,
    );

  console.log(
    `pack-npm: ${tarballByName.size} tarball(s) at ${version} in ${out}, contents checked`,
  );
});

function buildAndPack(root: string, out: string): Map<string, string> {
  try {
    buildPackages(root, "onFailure");

    return packPackages(root, out, "onFailure");
  } catch (error) {
    if (error instanceof StepFailure) throw new ReleaseError(error.message);

    throw error;
  }
}

interface PackRun {
  readonly root: string;
  readonly out: string;
  readonly version: string;
  readonly tarballByName: ReadonlyMap<string, string>;
}

function packageProblems(run: PackRun, directory: string): string[] {
  const { root, out, version, tarballByName } = run;
  const name: unknown = JSON.parse(
    readFileSync(join(root, directory, "package.json"), "utf8"),
  ).name;
  const tarball = typeof name === "string" ? tarballByName.get(name) : undefined;

  if (typeof name !== "string" || tarball === undefined)
    return [`${directory}: pnpm packed no tarball of ${String(name)}`];

  const files = tarballFiles(join(out, tarball));
  const manifest: unknown = JSON.parse(tarballFile(join(out, tarball), "package.json"));
  const entry = packEntry(manifest);
  const packed: PackedPackage = {
    directory,
    files,
    manifest,
    trackedFiles: trackedFiles(root, directory),
    packManifestText:
      entry !== undefined && files.includes(entry)
        ? tarballFile(join(out, tarball), entry)
        : undefined,
  };

  return tarballProblems(packed, { name, version }).map((problem) => `${tarball}: ${problem}`);
}

function tarballFile(tarball: string, file: string): string {
  return execFileSync("tar", ["-xzOf", tarball, `${TARBALL_PACKAGE_DIRECTORY}${file}`], {
    encoding: "utf8",
  });
}

function tarballFiles(tarball: string): string[] {
  return execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .split("\n")
    .filter((entry) => entry.startsWith(TARBALL_PACKAGE_DIRECTORY) && !entry.endsWith("/"))
    .map((entry) => entry.slice(TARBALL_PACKAGE_DIRECTORY.length));
}

function trackedFiles(root: string, directory: string): Set<string> {
  const listed = execFileSync("git", ["ls-files", "-z", "--", directory], {
    cwd: root,
    encoding: "utf8",
  });

  return new Set(
    listed
      .split("\0")
      .filter((file) => file !== "")
      .map((file) => file.slice(directory.length + 1)),
  );
}
