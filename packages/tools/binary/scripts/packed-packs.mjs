// The first-party packs as their npm tarballs hold them. `pnpm pack` rewrites a package.json, and a bundle vendors
// the pack's files, so a release build embeds the packed files: the binary then vendors the same bytes as the npm
// CLI on installed packs.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIRST_PARTY_PACK_PREFIX = "@seampact/pack-";

// The packs the binary embeds: its `@seampact/pack-*` dependencies.
export const EMBEDDED_PACK_NAMES = Object.keys(
  JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).dependencies,
).filter((name) => name.startsWith(FIRST_PARTY_PACK_PREFIX));

// `pnpm pack` names `@seampact/pack-hal` at 1.0.0 `seampact-pack-hal-1.0.0.tgz`.
function tarballPrefix(packName) {
  return `${packName.slice(1).replace("/", "-")}-`;
}

function tarballOf(packName, tarballDirectory, fail) {
  const prefix = tarballPrefix(packName);
  const matches = readdirSync(tarballDirectory).filter(
    (file) =>
      file.startsWith(prefix) && /^\d/.test(file.slice(prefix.length)) && file.endsWith(".tgz"),
  );

  if (matches.length !== 1) {
    fail(
      `${tarballDirectory} must hold one npm tarball of ${packName} (${prefix}<version>.tgz), found ${matches.length}`,
    );
  }

  return join(tarballDirectory, matches[0]);
}

// Extracts the tarball of each embedded pack under `outDirectory` and returns each pack's package directory by name.
export function extractPackedPacks(tarballDirectory, outDirectory, fail) {
  const packageDirectoryByName = new Map();

  for (const packName of EMBEDDED_PACK_NAMES) {
    const extracted = join(outDirectory, tarballPrefix(packName).slice(0, -1));

    mkdirSync(extracted, { recursive: true });
    execFileSync("tar", ["-xzf", tarballOf(packName, tarballDirectory, fail), "-C", extracted]);

    // npm tarballs hold the package under `package/`.
    const packageDirectory = join(extracted, "package");
    const packedName = JSON.parse(
      readFileSync(join(packageDirectory, "package.json"), "utf8"),
    ).name;

    if (packedName !== packName) fail(`the tarball of ${packName} holds the package ${packedName}`);

    packageDirectoryByName.set(packName, packageDirectory);
  }

  return packageDirectoryByName;
}
