// The command line of the JVM staging bundles. `check` runs the local Central checks on a bundle build-jvm staged
// (coordinates, POM fields, checksums, the compiler binaries against SHA256SUMS, the signatures by the release key),
// then writes its manifest as one JSON line; `verify` checks a downloaded bundle against that manifest.
//   node scripts/release/jvm/bundle.ts check <dir> --channel central|plugin-portal --version <version> --key <file>
//     [--sums <SHA256SUMS>] --manifest <out-file> [--root <dir>]
//   node scripts/release/jvm/bundle.ts verify <dir> --manifest <file>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";
import { bundleLayoutProblems, parsedReleaseSums } from "./bundle-layout.ts";
import {
  bundleManifest,
  checkBundleAgainstManifest,
  parsedBundleManifest,
  repositoryFiles,
} from "./bundle-manifest.ts";
import { bundleSignatureProblems } from "./bundle-signatures.ts";
import { CHANNELS, type Channel, expectedBundle, isChannel } from "./jvm-release.ts";

const USAGE =
  "bundle.ts check <dir> --channel central|plugin-portal --version <version> --key <file> [--sums <file>] " +
  "--manifest <out-file> | bundle.ts verify <dir> --manifest <file>";

const OPTIONS = {
  ...ROOT_OPTION,
  channel: { type: "string" },
  version: { type: "string" },
  key: { type: "string" },
  sums: { type: "string" },
  manifest: { type: "string" },
} as const;

export interface BundleCheck {
  readonly root: string;
  readonly directory: string;
  readonly channel: Channel;
  readonly version: string;
  readonly keyFile: string;
  /** The release `SHA256SUMS`, which the channel that publishes the compiler needs. */
  readonly sumsFile: string | undefined;
}

/** Every way the bundle is not what the channel publishes at the version; empty when it is. */
export function bundleProblems(check: BundleCheck): string[] {
  const files = repositoryFiles(check.directory);
  const expected = expectedBundle(check.root, check.channel, check.version);

  if (expected.compilerClassifiers.size > 0 && check.sumsFile === undefined)
    throw new ReleaseError(
      `the ${check.channel} bundle holds the compiler binaries: pass --sums <SHA256SUMS>`,
    );

  const releaseSums = parsedReleaseSums(
    check.sumsFile === undefined ? "" : readFileSync(check.sumsFile, "utf8"),
  );

  return [
    ...bundleLayoutProblems(check.directory, files, expected, releaseSums),
    ...bundleSignatureProblems(check.directory, files, check.keyFile),
  ];
}

function required(value: string | undefined, option: string): string {
  if (value === undefined) throw new ReleaseError(`--${option} is required; usage: ${USAGE}`);

  return value;
}

function existingDirectory(candidate: string | undefined): string {
  const directory = resolve(required(candidate, "<dir>"));

  if (!existsSync(directory))
    throw new ReleaseError(`${directory} does not exist: pass the staged repository directory`);

  return directory;
}

function runCheck(values: Record<string, string | undefined>, directory: string): void {
  const channel = required(values.channel, "channel");

  if (!isChannel(channel))
    throw new ReleaseError(`--channel is "${channel}", not one of ${CHANNELS.join(", ")}`);

  const check: BundleCheck = {
    root: repositoryRoot(values.root),
    directory,
    channel,
    version: releaseVersion(values.version),
    keyFile: required(values.key, "key"),
    sumsFile: values.sums,
  };
  const manifestFile = required(values.manifest, "manifest");
  const problems = bundleProblems(check);

  if (problems.length > 0)
    throw new ReleaseError(
      `the ${channel} bundle is not publishable, so no manifest was written:\n  ${problems.join("\n  ")}`,
    );

  const manifest = bundleManifest(directory);

  writeFileSync(manifestFile, `${JSON.stringify(manifest)}\n`);
  console.log(
    `bundle: ${channel} ${check.version} checked, ${manifest.length} files in ${manifestFile}`,
  );
}

function runVerify(values: Record<string, string | undefined>, directory: string): void {
  const manifestFile = required(values.manifest, "manifest");
  const manifest = parsedBundleManifest(readFileSync(manifestFile, "utf8"), manifestFile);

  checkBundleAgainstManifest(directory, manifest);
  console.log(`bundle: ${directory} holds exactly the ${manifest.length} files of ${manifestFile}`);
}

if (import.meta.main)
  await runReleaseCommand("bundle", () => {
    const { values, positionals } = parsedArguments(OPTIONS, USAGE);
    const [command, directory] = positionals;

    if (command === "check") runCheck(values, existingDirectory(directory));
    else if (command === "verify") runVerify(values, existingDirectory(directory));
    else throw new ReleaseError(`no command "${command ?? ""}"; usage: ${USAGE}`);
  });
