import { readFile, stat } from "node:fs/promises";
import type { JsonSchema } from "@seampact/spec/authoring";
import { BOOT_CHECK_ARTEFACT } from "@seampact/spec/config";
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
import type { ConfigWait } from "./config-waits.js";
import { formatKeyPath, type KeyPath } from "./key-path.js";

// One `seampact.config.yaml`, app or root, read with the loader's YAML rules and checked against its schema; each
// problem names the file, the line and column and the key path (ADR 0011 "The app config").

export type ConfigKind = "app config" | "root config";

// The config is trusted (A46), but a stray huge file is refused before it is parsed.
const MAX_CONFIG_BYTES = 1024 * 1024;

// The names that reach a JavaScript object's prototype, refused wherever the config writes them (A46).
const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

// `strictRequired` is off: the schemas list required keys in `oneOf` branches.
const AJV_OPTIONS = { allErrors: true, strict: true, strictRequired: false };

const SCHEMA_FIX = "Correct the value as the config schema states (ADR 0011 'The app config').";

export interface ParsedConfig {
  document: Document.Parsed;
  lineCounter: LineCounter;
  displayName: string;
  kind: ConfigKind;
}

export type ParseConfigOutcome =
  | { status: "parsed"; parsed: ParsedConfig; value: unknown }
  | { status: "refused"; problems: CliProblem[] };

// A problem the reader reports at a key before the schema check (a waiting or misplaced key); the schema errors at
// or under that key would repeat it.
export interface KeyProblem {
  path: KeyPath;
  problem: CliProblem;
}

export type ValidateConfigOutcome<Config> =
  | { status: "valid"; config: Config }
  | { status: "refused"; problems: CliProblem[] };

// The file's YAML as a plain value: its size, YAML syntax and prototype keys checked.
export async function parseConfigFile(
  file: string,
  displayName: string,
  kind: ConfigKind,
): Promise<ParseConfigOutcome> {
  const text = await readConfigText(file, displayName, kind);

  if (typeof text !== "string") return text;

  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    schema: "core",
    lineCounter,
    merge: false,
    uniqueKeys: true,
  });
  const parsed: ParsedConfig = { document, lineCounter, displayName, kind };

  const syntaxProblems = yamlProblems(parsed);

  if (syntaxProblems.length > 0) return { status: "refused", problems: syntaxProblems };

  const reservedProblems = reservedKeyProblems(parsed);

  if (reservedProblems.length > 0) return { status: "refused", problems: reservedProblems };

  return { status: "parsed", parsed, value: parsed.document.toJS() };
}

// The value checked against `schema`; the key problems come first, and the schema errors they cover are dropped.
export function validateConfig<Config>(
  parsed: ParsedConfig,
  value: unknown,
  schema: JsonSchema,
  keyProblems: readonly KeyProblem[],
): ValidateConfigOutcome<Config> {
  const validate = new Ajv2020(AJV_OPTIONS).compile<Config>(schema);
  const isValid = validate(value);
  const reportedPaths = new Set(keyProblems.map(({ path }) => formatKeyPath(path)));
  const schemaProblems = schemaErrorProblems(parsed, validate.errors ?? [], reportedPaths);
  const problems = [...keyProblems.map(({ problem }) => problem), ...schemaProblems];

  if (problems.length > 0 || !isValid) return { status: "refused", problems };

  return { status: "valid", config: value };
}

// Each waiting key as the problem `config.key.waits`.
export function waitProblems(parsed: ParsedConfig, waits: readonly ConfigWait[]): KeyProblem[] {
  return waits.map((wait) => ({
    path: wait.path,
    problem: {
      code: "config.key.waits",
      message: `${capitalized(wait.what)} is not available yet; it comes with ${wait.bringer}.`,
      fix: wait.fix ?? "Remove it from the config for now.",
      where: whereOf(parsed, wait.path),
    },
  }));
}

async function readConfigText(
  file: string,
  displayName: string,
  kind: ConfigKind,
): Promise<string | ParseConfigOutcome> {
  const size = await fileSize(file);

  if (size === undefined) {
    return refusedWith({
      code: "config.file.missing",
      message: `No ${kind} at ${displayName}.`,
      fix:
        kind === "app config"
          ? "Create `seampact.config.yaml` in the app's directory, or pass its path with `--config`."
          : "Pass the path of the monorepo root's `seampact.config.yaml`, the one holding `apps`.",
    });
  }

  if (size > MAX_CONFIG_BYTES) {
    return refusedWith({
      code: "config.file.too-large",
      message: `${displayName} holds ${size} bytes, over the ${MAX_CONFIG_BYTES} bytes ${articled(kind)} may hold.`,
      fix: `Pass the path of the ${kind} itself.`,
    });
  }

  return readFile(file, "utf8");
}

export async function fileSize(file: string): Promise<number | undefined> {
  try {
    const stats = await stat(file);

    return stats.isFile() ? stats.size : undefined;
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return undefined;

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
  reportedPaths: ReadonlySet<string>,
): CliProblem[] {
  const oneOfPaths = new Set(
    errors.filter((error) => error.keyword === "oneOf").map((error) => error.instancePath),
  );

  return errors
    .filter(
      (error) => !(error.schemaPath.includes("/oneOf/") && oneOfPaths.has(error.instancePath)),
    )
    .filter(
      (error) => !(error.keyword === "oneOf" && hasDeeperPath(error.instancePath, oneOfPaths)),
    )
    .map((error) => ({ keyword: error.keyword, ...schemaErrorProblem(parsed, error) }))
    .filter(({ keyPath }) => !isAtOrUnder(keyPath, reportedPaths))
    .filter(
      ({ keyword, keyPath }) => !(keyword === "oneOf" && holdsReportedPath(keyPath, reportedPaths)),
    )
    .map(({ problem }) => problem);
}

// A value fails its `oneOf` because of a key reported already, such as a waiting key: that report names it.
function holdsReportedPath(keyPath: string, reportedPaths: ReadonlySet<string>): boolean {
  return [...reportedPaths].some(
    (reportedPath) =>
      reportedPath.startsWith(`${keyPath}.`) || reportedPath.startsWith(`${keyPath}[`),
  );
}

// An outer `oneOf` fails because an inner one did; the inner one names the value to correct.
function hasDeeperPath(instancePath: string, paths: ReadonlySet<string>): boolean {
  return [...paths].some((path) => path.startsWith(`${instancePath}/`));
}

function isAtOrUnder(keyPath: string, reportedPaths: ReadonlySet<string>): boolean {
  return [...reportedPaths].some(
    (reportedPath) =>
      keyPath === reportedPath ||
      keyPath.startsWith(`${reportedPath}.`) ||
      keyPath.startsWith(`${reportedPath}[`),
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
        message: `'${additionalProperty}' is not a key the ${parsed.kind} takes here.`,
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
      problem: { code: "config.schema", ...oneOfSentences(path), where: whereOf(parsed, path) },
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

// The forms a `oneOf` of the config schemas lets a value take, by where it sits.
function oneOfSentences(path: KeyPath): { message: string; fix: string } {
  const [first] = path;

  if (first === "sources") {
    return {
      message:
        "A source takes one form: 'path', 'package' with 'version', 'release', 'git' or 'maven'; 'integrity' goes with a bundle form only.",
      fix: "Keep the keys of one form (ADR 0011 'The app config').",
    };
  }

  if (path.at(-1) === BOOT_CHECK_ARTEFACT) {
    return {
      message: "'bootCheck' is true, false or '{ frameworkRoutes }'.",
      fix: "Switch the boot check with a boolean, or its framework-route check alone with '{ frameworkRoutes: false }'.",
    };
  }

  if (first === "targets") {
    return {
      message: "A target entry takes exactly one of 'api' and 'apis'.",
      fix: "Name one api with 'api', or several with 'apis'.",
    };
  }

  if (path.at(-1) === "extensions") {
    return {
      message: "'extensions' is 'all', 'none' or a list of extension names.",
      fix: "Write 'all', 'none' or a list such as [access, paging].",
    };
  }

  if (path.length === 1) {
    return {
      message: "'openapi' is 'none' or a mapping from api names to their documents.",
      fix: "Write 'openapi: none', or map each api to its document's path.",
    };
  }

  return {
    message:
      "An api's documents are a path, '{ path, ...options }', or a mapping from each document id to one of those.",
    fix: "Write the path of the api's one document, or map each of its documents to a path (ADR 0011 'The app config').",
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
export function whereOf(parsed: ParsedConfig, path: KeyPath): string {
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

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function articled(kind: ConfigKind): string {
  return kind === "app config" ? "an app config" : "a root config";
}

function refusedWith(problem: CliProblem): ParseConfigOutcome {
  return { status: "refused", problems: [problem] };
}
