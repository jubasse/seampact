import { execFileSync } from "node:child_process";
import { join } from "node:path";

const PACKAGE_PREFIX = "package/";
const DIST_PREFIX = `${PACKAGE_PREFIX}dist/`;

function entryOf(manifest: unknown, field: string): string | undefined {
  const value: unknown =
    typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, field) : undefined;

  return typeof value === "string" ? join(PACKAGE_PREFIX, value) : undefined;
}

/** Refuses a packed tarball without `dist` or without a declared entry file, naming the package. */
export function checkTarballContents(tarball: string): void {
  const listing = execFileSync("tar", ["tzf", tarball]).toString().split("\n");
  const files = new Set(listing.map((line) => join(line)));
  const manifest: unknown = JSON.parse(
    execFileSync("tar", ["xzOf", tarball, `${PACKAGE_PREFIX}package.json`]).toString(),
  );
  const name =
    typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, "name") : tarball;

  if (!listing.some((line) => line.startsWith(DIST_PREFIX))) {
    throw new Error(
      `bench: the packed ${String(name)} (${tarball}) has no dist/; build the packages again (disk or inode shortage during the pack?).`,
    );
  }

  for (const field of ["main", "types"]) {
    const entry = entryOf(manifest, field);

    if (entry !== undefined && !files.has(entry)) {
      throw new Error(
        `bench: the packed ${String(name)} (${tarball}) lacks its ${field} file ${entry}.`,
      );
    }
  }
}
