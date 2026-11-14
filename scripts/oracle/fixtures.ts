import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const FIXTURES_ROOT = join(REPO_ROOT, "fixtures");
export const EXPECTED_ROOT = join(FIXTURES_ROOT, "expected");

const EXCLUDED_FILE = join(dirname(fileURLToPath(import.meta.url)), "excluded.json");
const ENTRY_FILES = ["workspace.yaml", "api.yaml"] as const;

/** `excluded.json`: fixtures the oracle cannot compile standalone, and fixtures whose halves it skips. */
export interface ExcludedFixtures {
  /** Fixture path to the one-line reason it is not compiled. */
  fixtures: Record<string, string>;
  /** Fixture path to the one-line reason its halves are not written. */
  halves: Record<string, string>;
}

export interface OracleFixture {
  /** The path under `fixtures/`, `/` separated. */
  path: string;
  directory: string;
  /** `workspace.yaml` when the directory has one, else `api.yaml`. */
  entry: string;
}

// UTF-16 code unit order, as the compiler sorts.
const byCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function readExcluded(): ExcludedFixtures {
  const parsed: unknown = JSON.parse(readFileSync(EXCLUDED_FILE, "utf8"));

  if (typeof parsed !== "object" || parsed === null)
    throw new Error(`${EXCLUDED_FILE} is an object`);

  const members = (name: string): Record<string, string> => {
    const value: unknown = Reflect.get(parsed, name);

    if (typeof value !== "object" || value === null)
      throw new Error(`${EXCLUDED_FILE}: '${name}' is an object of reasons`);

    return Object.fromEntries(
      Object.entries(value).map(([path, reason]) => {
        if (typeof reason !== "string")
          throw new Error(`${EXCLUDED_FILE}: '${path}' needs a reason`);

        return [path, reason];
      }),
    );
  };

  return { fixtures: members("fixtures"), halves: members("halves") };
}

function entryOf(directory: string): string | undefined {
  return ENTRY_FILES.find((name) => existsSync(join(directory, name)));
}

function walk(directory: string, found: OracleFixture[]): void {
  const entry = entryOf(directory);

  if (entry !== undefined)
    found.push({
      path: relative(FIXTURES_ROOT, directory).split("\\").join("/"),
      directory,
      entry,
    });

  for (const name of readdirSync(directory)) {
    const child = join(directory, name);

    if (child === EXPECTED_ROOT || name === "node_modules") continue;

    if (statSync(child).isDirectory()) walk(child, found);
  }
}

// The names under a fixture's expected directory that hold its own files: a nested fixture there would collide.
const OWN_EXPECTED_NAMES = ["diagnostics.json", "ir", "source-map", "halves", "schema-calls"];

function refuseCollidingNames(fixtures: readonly OracleFixture[]): void {
  for (const { path } of fixtures) {
    const parent = fixtures.find((other) => path.startsWith(`${other.path}/`));
    const below = parent === undefined ? undefined : path.slice(parent.path.length + 1);

    if (below !== undefined && OWN_EXPECTED_NAMES.includes(below.split("/")[0] ?? ""))
      throw new Error(
        `fixture ${path} is nested in ${parent?.path} under a name its expected outputs use; rename its directory`,
      );
  }
}

/** Every directory under `fixtures/` holding a `workspace.yaml` or an `api.yaml`, sorted, `expected/` left out. */
export function discoverFixtures(): OracleFixture[] {
  const found: OracleFixture[] = [];

  walk(FIXTURES_ROOT, found);
  found.sort((left, right) => byCodeUnits(left.path, right.path));
  refuseCollidingNames(found);

  return found;
}

const escapeRegExp = (text: string): string => text.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/** A fixture glob: `**` matches any path, `*` one segment, `?` one character; no glob matches by prefix too. */
export function fixtureMatcher(glob: string | undefined): (path: string) => boolean {
  if (glob === undefined) return () => true;

  const pattern = glob
    .split("**")
    .map((part) => escapeRegExp(part).replaceAll("*", "[^/]*").replaceAll("?", "[^/]"))
    .join(".*");
  const regular = new RegExp(`^${pattern}(/.*)?$`);

  return (path) => regular.test(path);
}
