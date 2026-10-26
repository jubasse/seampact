import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type CliIo, EXIT_USAGE, printProblems } from "./cli-io.js";
import type { CliProblem } from "./cli-problem.js";
import {
  type BundleCommandOptions,
  bundleCommand,
  type ConfigLocation,
  checkCommand,
  compileCommand,
  configLocation,
  diffCommand,
  EDITOR_SCHEMAS_POLICIES,
  type EditorSchemasPolicy,
  explainCommand,
  generateCommand,
  initCommand,
  lintCommand,
  type NativeEntryPolicy,
  type PlanInputs,
  REFUSE_NATIVE_ENTRIES,
} from "./commands/index.js";
import { errorCode } from "./error-code.js";

const COMMAND_USAGE: ReadonlyMap<string, string> = new Map([
  [
    "init",
    "  init [--blank] [--editor-schemas[=ignore|commit|none]] [--no-modelines] [--no-ignore-files]\n                                           Write a new project here: seampact.config.yaml and contract/api.yaml, a small example (--blank: the api header alone), with its modeline and editor schemas, git-ignored by default.\n  init --modelines [--config <path>] [--editor-schemas[=ignore|commit|none]] [--no-ignore-files]\n                                           Write or correct the modeline of every contract file of the app config's `path` sources, and their editor schemas.",
  ],
  [
    "compile",
    "  compile [--config <path>] [--out <dir>] [--editor-schemas]\n                                           Compile the contract sources the app config's targets use; --editor-schemas writes each contract's editor schemas, which check declared names (to workspace.editorSchemas, .seampact/schemas by default).",
  ],
  [
    "generate",
    "  generate [--config <path>] [--force] [--app-directory <dir> [--config-name <label>]] [--bundle-directory <source>=<dir>]\n                                           Generate every target entry of the app config, or of every app a root config lists; --force overwrites, or removes when stale, a generated file edited by hand. A build plugin passes --app-directory (the --config text read as that directory's app config, named --config-name in problems) and --bundle-directory (a bundle it already fetched, checked against the source's integrity, never fetched).",
  ],
  [
    "check",
    "  check [--config <path>] [--app-directory <dir> [--config-name <label>]] [--bundle-directory <source>=<dir>]\n                                           Fail when the committed generated files or documents differ from a fresh run; --app-directory, --config-name and --bundle-directory as for generate.",
  ],
  [
    "lint",
    "  lint [--config <path>]                   Run the core lint rules over each contract source.",
  ],
  [
    "diff",
    '  diff --against <path> [--config <path>]  Classify the changes since the IRs at <path> (an IR file, or a directory of <api>.ir.json that "compile --out <dir>" writes).',
  ],
  [
    "explain",
    "  explain <api>.<operationId> [--config <path>]  Print one operation whole, each line commented with the derivation and the file and line it comes from; the api may be left out when the sources hold one.",
  ],
  [
    "bundle",
    "  bundle (--out <dir> | --tarball <file> | --npm-package <dir>) [--source <name>] [--name <name>] [--version <version>] [--config <path>]\n                                           Write the bundle of a `path` source (the config's only one, or --source) and print its integrity; the contract name and version default to the workspace's package.json.",
  ],
]);

// The flags of the CLI design that are not available yet; each answers with exit code 2.
const WAITING_FLAGS: ReadonlySet<string> = new Set(["--watch", "--strict", "--source-map"]);

const HELP_ARGUMENTS: ReadonlySet<string> = new Set(["help", "--help", "-h"]);

// Runs one CLI command. `argv` holds the arguments after the program name; the result is the exit code: 0 when
// everything was written, 1 on a refusal or a compile error, 2 on a usage error.
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined) return usageError(io, "No command given.");

  if (HELP_ARGUMENTS.has(command)) {
    io.stdout(usageText());

    return 0;
  }

  const waitingFlag = rest.find((argument) =>
    WAITING_FLAGS.has(argument.split("=")[0] ?? argument),
  );

  if (waitingFlag !== undefined) return notAvailable(io, `The flag '${waitingFlag}'`);

  if (command === "init") return runInit(rest, io);

  if (command === "compile") return runCompile(rest, io);

  if (command === "generate") return runGenerate(rest, io);

  if (command === "check") return runCheck(rest, io);

  if (command === "lint") return runLint(rest, io);

  if (command === "diff") return runDiff(rest, io);

  if (command === "bundle") return runBundle(rest, io);

  if (command === "explain") return runExplain(rest, io);

  return usageError(io, `Unknown command '${command}'.`);
}

const EDITOR_SCHEMAS_FLAG = "--editor-schemas";
const DEFAULT_EDITOR_SCHEMAS_POLICY: EditorSchemasPolicy = "ignore";

async function runInit(args: readonly string[], io: CliIo): Promise<number> {
  // A bare `--editor-schemas` asks for the default policy.
  const withPolicy = args.map((argument) =>
    argument === EDITOR_SCHEMAS_FLAG
      ? `${EDITOR_SCHEMAS_FLAG}=${DEFAULT_EDITOR_SCHEMAS_POLICY}`
      : argument,
  );
  const parsed = parseCommandArgs(withPolicy, {
    config: { type: "string" },
    blank: { type: "boolean" },
    modelines: { type: "boolean" },
    "editor-schemas": { type: "string" },
    "no-modelines": { type: "boolean" },
    "no-ignore-files": { type: "boolean" },
  });

  if (parsed.status === "refused") return usageError(io, parsed.message);

  const { values } = parsed;
  const policy = stringOption(values["editor-schemas"]) ?? DEFAULT_EDITOR_SCHEMAS_POLICY;
  const editorSchemas = EDITOR_SCHEMAS_POLICIES.find((each) => each === policy);

  if (editorSchemas === undefined)
    return usageError(
      io,
      `\`--editor-schemas\` takes ${EDITOR_SCHEMAS_POLICIES.join(", ")}, not '${policy}'.`,
    );

  const ignoreFiles = values["no-ignore-files"] === true ? "skip" : "write";

  if (values.modelines === true) {
    if (values.blank === true || values["no-modelines"] === true)
      return usageError(
        io,
        "`init --modelines` writes no new project: drop `--blank` and `--no-modelines`.",
      );

    return initCommand(
      {
        kind: "modelines",
        location: configLocation(io.cwd, stringOption(values.config)),
        editorSchemas,
        ignoreFiles,
      },
      io,
    );
  }

  if (values.config !== undefined)
    return usageError(
      io,
      "`init` writes its config in the working directory; `--config` goes with `--modelines`.",
    );

  return initCommand(
    {
      kind: "new-project",
      content: values.blank === true ? "blank" : "example",
      editorSchemas,
      modelines: values["no-modelines"] === true ? "skip" : "write",
      ignoreFiles,
    },
    io,
  );
}

async function runCompile(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCommandArgs(args, {
    config: { type: "string" },
    out: { type: "string" },
    "editor-schemas": { type: "boolean" },
  });

  if (parsed.status === "refused") return usageError(io, parsed.message);

  const { config, out } = parsed.values;

  return compileCommand(
    configLocation(io.cwd, stringOption(config)),
    {
      irOutDir: stringOption(out),
      editorSchemas: parsed.values["editor-schemas"] === true ? "write" : "skip",
    },
    io,
  );
}

const PLUGIN_RUN_OPTIONS: OptionSpec = {
  config: { type: "string" },
  "app-directory": { type: "string" },
  "bundle-directory": { type: "string", multiple: true },
  "config-name": { type: "string" },
};

async function runGenerate(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCommandArgs(args, { ...PLUGIN_RUN_OPTIONS, force: { type: "boolean" } });

  if (parsed.status === "refused") return usageError(io, parsed.message);

  const run = pluginRunOf(parsed.values, io, "generate");

  if (run.status === "refused") return usageError(io, run.message);

  return generateCommand(
    run.location,
    io,
    { onHandEdit: parsed.values.force === true ? "overwrite" : "refuse" },
    run.inputs,
  );
}

async function runCheck(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCommandArgs(args, PLUGIN_RUN_OPTIONS);

  if (parsed.status === "refused") return usageError(io, parsed.message);

  const run = pluginRunOf(parsed.values, io, "check");

  if (run.status === "refused") return usageError(io, run.message);

  return checkCommand(run.location, io, run.inputs);
}

type PluginRun =
  | { status: "read"; location: ConfigLocation; inputs: PlanInputs }
  | { status: "refused"; message: string };

// The config and inputs of `generate` and `check`: `--app-directory` reads the `--config` text as the app config of
// that directory, and each `--bundle-directory <source>=<dir>` hands over a bundle the build plugin already fetched.
function pluginRunOf(values: ParsedValues, io: CliIo, command: string): PluginRun {
  const config = stringOption(values.config);
  const appDirectory = stringOption(values["app-directory"]);
  const configName = stringOption(values["config-name"]);
  const localBundles = new Map<string, string>();

  for (const pair of listOption(values["bundle-directory"])) {
    const separator = pair.indexOf("=");

    if (separator <= 0 || separator === pair.length - 1)
      return {
        status: "refused",
        message: `\`--bundle-directory\` takes <source>=<dir>, not '${pair}'.`,
      };

    const source = pair.slice(0, separator);

    if (localBundles.has(source))
      return {
        status: "refused",
        message: `\`--bundle-directory\` hands over the source '${source}' twice; pass one directory per source.`,
      };

    localBundles.set(source, resolve(io.cwd, pair.slice(separator + 1)));
  }

  const inputs: PlanInputs = { nativeEntries: nativeEntryPolicy(io, command), localBundles };

  if (configName !== undefined && (configName.trim() === "" || /[\r\n]/.test(configName)))
    return {
      status: "refused",
      message: "`--config-name` takes a non-empty, one-line label, the name problems give the config.",
    };

  if (appDirectory === undefined && configName !== undefined)
    return {
      status: "refused",
      message: "`--config-name` names the config `--app-directory` reads; pass both.",
    };

  if (appDirectory === undefined)
    return { status: "read", location: configLocation(io.cwd, config), inputs };

  if (config === undefined)
    return {
      status: "refused",
      message: "`--app-directory` needs `--config <path>`, the file it reads.",
    };

  const location = configLocation(resolve(io.cwd, appDirectory), undefined);

  if (existsSync(location.file))
    return {
      status: "refused",
      message: `\`--app-directory\` reads --config as the app config of ${location.file}, which exists; pass that file with \`--config\` instead.`,
    };

  return {
    status: "read",
    location: {
      ...location,
      displayName: configName ?? location.displayName,
      textFile: resolve(io.cwd, config),
    },
    inputs,
  };
}

// The host's policy for a command it runs on native entries only; the Node CLI's own otherwise.
function nativeEntryPolicy(io: CliIo, command: string): NativeEntryPolicy {
  const npmEntryRefusal = io.nativeOnlyCommands?.get(command);

  return npmEntryRefusal === undefined ? REFUSE_NATIVE_ENTRIES : { kind: "leave", npmEntryRefusal };
}

async function runLint(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCommandArgs(args, { config: { type: "string" } });

  if (parsed.status === "refused") return usageError(io, parsed.message);

  return lintCommand(configLocation(io.cwd, stringOption(parsed.values.config)), io);
}

async function runDiff(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCommandArgs(args, {
    config: { type: "string" },
    against: { type: "string" },
  });

  if (parsed.status === "refused") return usageError(io, parsed.message);

  const against = stringOption(parsed.values.against);

  if (against === undefined) return usageError(io, "`diff` needs `--against <path>`.");

  return diffCommand(configLocation(io.cwd, stringOption(parsed.values.config)), against, io);
}

async function runExplain(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCommandArgs(args, { config: { type: "string" } }, ONE_POSITIONAL);

  if (parsed.status === "refused") return usageError(io, parsed.message);

  const [operation] = parsed.positionals;

  if (operation === undefined || parsed.positionals.length > 1)
    return usageError(io, "`explain` takes one operation, as `<api>.<operationId>`.");

  return explainCommand(configLocation(io.cwd, stringOption(parsed.values.config)), operation, io);
}

const BUNDLE_OUTPUT_FLAGS = ["out", "tarball", "npm-package"] as const;

async function runBundle(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCommandArgs(args, {
    config: { type: "string" },
    source: { type: "string" },
    out: { type: "string" },
    tarball: { type: "string" },
    "npm-package": { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
  });

  if (parsed.status === "refused") return usageError(io, parsed.message);

  const { values } = parsed;
  const given = BUNDLE_OUTPUT_FLAGS.flatMap((flag) => {
    const path = stringOption(values[flag]);

    return path === undefined ? [] : [bundleOutput(flag, path)];
  });
  const [output] = given;

  if (output === undefined || given.length > 1)
    return usageError(
      io,
      "`bundle` needs exactly one of `--out`, `--tarball` and `--npm-package`.",
    );

  const name = stringOption(values.name);
  const version = stringOption(values.version);
  const source = stringOption(values.source);
  const options: BundleCommandOptions = {
    output,
    contract: {
      ...(name === undefined ? {} : { name }),
      ...(version === undefined ? {} : { version }),
    },
    ...(source === undefined ? {} : { source }),
  };

  return bundleCommand(configLocation(io.cwd, stringOption(values.config)), options, io);
}

function bundleOutput(
  flag: (typeof BUNDLE_OUTPUT_FLAGS)[number],
  path: string,
): BundleCommandOptions["output"] {
  if (flag === "out") return { directory: path };

  return flag === "tarball" ? { tarball: path } : { npmPackage: path };
}

type OptionSpec = Record<string, { type: "string" | "boolean"; multiple?: boolean }>;

type ParsedValues = Record<string, string | boolean | (string | boolean)[] | undefined>;

type ParsedArgs =
  | {
      status: "parsed";
      values: ParsedValues;
      positionals: string[];
    }
  | { status: "refused"; message: string };

// Whether a command takes positional arguments besides its options.
type Positionals = "none" | "one";

const ONE_POSITIONAL: Positionals = "one";

function parseCommandArgs(
  args: readonly string[],
  options: OptionSpec,
  positionals: Positionals = "none",
): ParsedArgs {
  try {
    const parsed = parseArgs({
      args: [...args],
      options,
      strict: true,
      allowPositionals: positionals !== "none",
    });

    return { status: "parsed", values: { ...parsed.values }, positionals: parsed.positionals };
  } catch (error) {
    const code = errorCode(error);

    if (error instanceof Error && typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")) {
      return {
        status: "refused",
        message: error.message.endsWith(".") ? error.message : `${error.message}.`,
      };
    }

    throw error;
  }
}

function stringOption(value: ParsedValues[string]): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function listOption(value: ParsedValues[string]): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function usageError(io: CliIo, message: string): number {
  const problem: CliProblem = {
    code: "cli.usage",
    message,
    fix: "Run `seampact help` for the commands and their options.",
  };

  printProblems(io, [problem]);
  io.stderr(usageText());

  return EXIT_USAGE;
}

function notAvailable(io: CliIo, subject: string): number {
  printProblems(io, [
    {
      code: "cli.not-available",
      message: `${subject} is not available yet.`,
      fix: `Use ${listed(quotedCommands())}.`,
    },
  ]);

  return EXIT_USAGE;
}

function usageText(): string {
  const lines = [...COMMAND_USAGE.values()];

  return `Usage: seampact <command> [options]\n\nCommands:\n${lines.join("\n")}\n`;
}

// `seampact compile`, then the other names, each in backticks.
function quotedCommands(): string[] {
  return [...COMMAND_USAGE.keys()].map(
    (name) => `\`${name === "compile" ? "seampact compile" : name}\``,
  );
}

// `a`, `b` or `c`
function listed(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}
