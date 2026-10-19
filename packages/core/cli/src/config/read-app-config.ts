import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  APP_CONFIG_SCHEMA,
  type AppConfig,
  DEFAULT_OUT_DIR,
  type TargetEntry,
} from "@seampact/spec/config";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import {
  type Document,
  isAlias,
  isMap,
  isNode,
  isScalar,
  LineCounter,
  parseDocument,
  visit,
} from "yaml";
import type { CliProblem } from "../cli-problem.js";
import { errorCode } from "../error-code.js";
import { findConfigWaits } from "./config-waits.js";
import { formatKeyPath, type KeyPath } from "./key-path.js";

// The config is trusted (A46), but a stray huge file is refused before it is parsed.
const MAX_CONFIG_BYTES = 1024 * 1024;

// The names that reach a JavaScript object's prototype, refused wherever the config writes them (A46).
const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

// `strictRequired` is off: the schema's `api` or `apis` choice lists required keys in `oneOf` branches.
const AJV_OPTIONS = { allErrors: true, strict: true, strictRequired: false };

const SCHEMA_FIX = "Correct the value as the app config schema states (ADR 0011 'The app config').";

// One target entry with its output root: `<outDir>/<out>`, absolute.
export interface AppConfigEntry {
  entry: TargetEntry;
  root: string;
}

export interface LoadedAppConfig {
  file: string;
  outDir: string;
  // Each source name with its absolute workspace directory.
  sources: ReadonlyMap<string, string>;
  entries: readonly AppConfigEntry[];
}

export type ReadAppConfigOutcome =
  | { status: "read"; config: LoadedAppConfig }
  | { status: "refused"; problems: CliProblem[] };

interface ParsedConfig {
  document: Document.Parsed;
  lineCounter: LineCounter;
  displayName: string;
}

// Reads `seampact.config.yaml` (ADR 0011 "The app config"): YAML, prototype keys and waiting keys refused, the
// value checked against the app config schema, paths resolved against the config file's directory. Each problem
// names the file, the line and column and the key path.
export async function readAppConfig(
  file: string,
  displayName: string,
): Promise<ReadAppConfigOutcome> {
  const text = await readConfigText(file, displayName);

  if (typeof text !== "string") return text;

  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    schema: "core",
    lineCounter,
    merge: false,
    uniqueKeys: true,
  });
  const parsed: ParsedConfig = { document, lineCounter, displayName };

  const syntaxProblems = yamlProblems(parsed);

  if (syntaxProblems.length > 0) return { status: "refused", problems: syntaxProblems };

  const reservedProblems = reservedKeyProblems(parsed);

  if (reservedProblems.length > 0) return { status: "refused", problems: reservedProblems };

  const value: unknown = document.toJS();
  const waits = findConfigWaits(value);
  const waitProblems: CliProblem[] = waits.map((wait) => ({
    code: "config.key.waits",
    message: `${capitalized(wait.what)} is not available yet; it comes with ${wait.bringer}.`,
    fix: "Remove it from the config for now.",
    where: whereOf(parsed, wait.path),
  }));
  const waitPaths = new Set(waits.map((wait) => formatKeyPath(wait.path)));

  const validate = new Ajv2020(AJV_OPTIONS).compile<AppConfig>(APP_CONFIG_SCHEMA);
  const isValid = validate(value);
  const schemaProblems = schemaErrorProblems(parsed, validate.errors ?? [], waitPaths);
  const problems = [...waitProblems, ...schemaProblems];

  if (problems.length > 0 || !isValid) return { status: "refused", problems };

  return resolveAppConfig(file, parsed, value);
}

async function readConfigText(
  file: string,
  displayName: string,
): Promise<string | ReadAppConfigOutcome> {
  const size = await fileSize(file);

  if (size === undefined) {
    return refusedWith({
      code: "config.file.missing",
      message: `No app config at ${displayName}.`,
      fix: "Create `seampact.config.yaml` in the app's directory, or pass its path with `--config`.",
    });
  }

  if (size > MAX_CONFIG_BYTES) {
    return refusedWith({
      code: "config.file.too-large",
      message: `${displayName} holds ${size} bytes, over the ${MAX_CONFIG_BYTES} bytes an app config may hold.`,
      fix: "Pass the path of the app config itself with `--config`.",
    });
  }

  return readFile(file, "utf8");
}

async function fileSize(file: string): Promise<number | undefined> {
  try {
    const stats = await stat(file);

    return stats.isFile() ? stats.size : undefined;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;

    throw error;
  }
}

function yamlProblems(parsed: ParsedConfig): CliProblem[] {
  return parsed.document.errors.map((error) => {
    const position = error.linePos?.[0];
    const at = position === undefined ? "" : `:${position.line}:${position.col}`;

    return {
      code: "config.yaml.syntax",
      message: yamlErrorSentence(error.message),
      fix: "Correct the YAML at that position.",
      where: `${parsed.displayName}${at}`,
    };
  });
}

// The first line of a `yaml` error, without the position the problem already prints.
function yamlErrorSentence(message: string): string {
  const firstLine = message.split("\n")[0] ?? message;

  return `${firstLine.replace(/ at line \d+, column \d+:?$/, "")}.`;
}

function reservedKeyProblems(parsed: ParsedConfig): CliProblem[] {
  const problems: CliProblem[] = [];

  visit(parsed.document, {
    Pair(_, pair) {
      const key = isAlias(pair.key) ? pair.key.resolve(parsed.document) : pair.key;

      if (!isScalar(key) || typeof key.value !== "string") return;

      if (!RESERVED_KEYS.has(key.value)) return;

      problems.push({
        code: "config.key.reserved",
        message: `The key '${key.value}' is reserved: it would reach a JavaScript object's prototype.`,
        fix: "Rename or remove the key.",
        where: `${parsed.displayName}${positionText(parsed, isNode(pair.key) ? pair.key.range?.[0] : undefined)}`,
      });
    },
  });

  return problems;
}

function schemaErrorProblems(
  parsed: ParsedConfig,
  errors: readonly ErrorObject[],
  waitPaths: ReadonlySet<string>,
): CliProblem[] {
  const oneOfPaths = new Set(
    errors.filter((error) => error.keyword === "oneOf").map((error) => error.instancePath),
  );

  return errors
    .filter(
      (error) => !(error.schemaPath.includes("/oneOf/") && oneOfPaths.has(error.instancePath)),
    )
    .map((error) => schemaErrorProblem(parsed, error))
    .filter(({ keyPath }) => !isUnderWait(keyPath, waitPaths))
    .map(({ problem }) => problem);
}

// A schema error at or under a waiting key repeats the `config.key.waits` problem of that key.
function isUnderWait(keyPath: string, waitPaths: ReadonlySet<string>): boolean {
  return [...waitPaths].some(
    (waitPath) =>
      keyPath === waitPath ||
      keyPath.startsWith(`${waitPath}.`) ||
      keyPath.startsWith(`${waitPath}[`),
  );
}

function schemaErrorProblem(
  parsed: ParsedConfig,
  error: ErrorObject,
): { problem: CliProblem; keyPath: string } {
  const path = instancePathOf(error.instancePath);
  const keyPath = formatKeyPath(path);
  const { additionalProperty, missingProperty } = error.params;

  if (error.keyword === "additionalProperties" && typeof additionalProperty === "string") {
    const keyPathWithKey = [...path, additionalProperty];

    return {
      keyPath: formatKeyPath(keyPathWithKey),
      problem: {
        code: "config.schema",
        message: `'${additionalProperty}' is not a key the app config takes here.`,
        fix: "Remove the key, or correct its spelling (ADR 0011 'The app config').",
        where: whereOf(parsed, keyPathWithKey),
      },
    };
  }

  if (error.keyword === "required" && typeof missingProperty === "string") {
    return {
      keyPath,
      problem: {
        code: "config.schema",
        message: `The key '${missingProperty}' is required here.`,
        fix: `Add '${missingProperty}'.`,
        where: whereOf(parsed, path),
      },
    };
  }

  if (error.keyword === "oneOf") {
    return {
      keyPath,
      problem: {
        code: "config.schema",
        message: "A target entry takes exactly one of 'api' and 'apis'.",
        fix: "Name one api with 'api', or several with 'apis'.",
        where: whereOf(parsed, path),
      },
    };
  }

  return {
    keyPath,
    problem: {
      code: "config.schema",
      message: `The value ${error.message ?? `fails the schema keyword '${error.keyword}'`}.`,
      fix: SCHEMA_FIX,
      where: whereOf(parsed, path),
    },
  };
}

function instancePathOf(instancePath: string): KeyPath {
  if (instancePath === "") return [];

  return instancePath
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

// `<file>:<line>:<column> <key path>`, the position of the key when the path ends at one.
function whereOf(parsed: ParsedConfig, path: KeyPath): string {
  const offset = keyOffset(parsed, path);
  const keyPath = path.length === 0 ? "" : ` ${formatKeyPath(path)}`;

  return `${parsed.displayName}${positionText(parsed, offset)}${keyPath}`;
}

function keyOffset(parsed: ParsedConfig, path: KeyPath): number | undefined {
  const last = path.at(-1);
  const parent = parsed.document.getIn(path.slice(0, -1), true);

  if (typeof last === "string" && isMap(parent)) {
    const pair = parent.items.find((item) => isScalar(item.key) && item.key.value === last);

    if (pair !== undefined && isNode(pair.key)) return pair.key.range?.[0];
  }

  const node = parsed.document.getIn(path, true);

  return isNode(node) ? node.range?.[0] : undefined;
}

function positionText(parsed: ParsedConfig, offset: number | undefined): string {
  if (offset === undefined) return "";

  const { line, col } = parsed.lineCounter.linePos(offset);

  return `:${line}:${col}`;
}

function resolveAppConfig(
  file: string,
  parsed: ParsedConfig,
  config: AppConfig,
): ReadAppConfigOutcome {
  const directory = dirname(file);
  const outDir = resolve(directory, config.outDir ?? DEFAULT_OUT_DIR);
  const sources = new Map(
    Object.entries(config.sources ?? {}).map(([name, source]) => [
      name,
      resolve(directory, source.path),
    ]),
  );
  const targets = config.targets ?? [];
  const entries = targets.map((entry) => ({
    entry: structuredClone(entry),
    root: resolve(outDir, entry.out ?? entry.id),
  }));

  const problems = [
    ...duplicateIdProblems(parsed, targets),
    ...outsideOutDirProblems(parsed, outDir, entries),
    ...overlappingOutProblems(parsed, entries),
  ];

  if (problems.length > 0) return { status: "refused", problems };

  return { status: "read", config: { file, outDir, sources, entries } };
}

function duplicateIdProblems(parsed: ParsedConfig, targets: readonly TargetEntry[]): CliProblem[] {
  return targets
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => targets.findIndex((other) => other.id === entry.id) !== index)
    .map(({ entry, index }) => ({
      code: "config.target.duplicate-id",
      message: `Two target entries have the id '${entry.id}'.`,
      fix: "Give each target entry its own id.",
      where: whereOf(parsed, ["targets", index, "id"]),
    }));
}

function outsideOutDirProblems(
  parsed: ParsedConfig,
  outDir: string,
  entries: readonly AppConfigEntry[],
): CliProblem[] {
  return entries
    .map((each, index) => ({ each, index }))
    .filter(({ each }) => !isStrictlyInside(outDir, each.root))
    .map(({ each, index }) => ({
      code: "config.out.outside",
      message: `The output directory of '${each.entry.id}' is not inside \`outDir\` (${outDir}).`,
      fix: "Give `out` a relative path that stays inside `outDir`.",
      where: whereOf(parsed, ["targets", index, "out"]),
    }));
}

// Two entries writing to the same directory, or one inside the other, would remove each other's files.
function overlappingOutProblems(
  parsed: ParsedConfig,
  entries: readonly AppConfigEntry[],
): CliProblem[] {
  return entries.flatMap((each, index) =>
    entries
      .slice(index + 1)
      .filter(
        (other) => isInsideOrEqual(each.root, other.root) || isInsideOrEqual(other.root, each.root),
      )
      .map((other) => ({
        code: "config.out.overlap",
        message: `The entries '${each.entry.id}' and '${other.entry.id}' write to the same directory, or one inside the other.`,
        fix: "Give each entry its own `out` directory, side by side under `outDir`.",
        where: whereOf(parsed, ["targets", index]),
      })),
  );
}

function isStrictlyInside(parent: string, child: string): boolean {
  return child !== parent && isInsideOrEqual(parent, child);
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const path = relative(parent, child);

  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function refusedWith(problem: CliProblem): ReadAppConfigOutcome {
  return { status: "refused", problems: [problem] };
}
