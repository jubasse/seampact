import { parseArgs } from "node:util";
import { EXIT_USAGE, type CliIo, printProblems } from "./cli-io.js";
import type { CliProblem } from "./cli-problem.js";
import { errorCode } from "./error-code.js";
import { compileCommand, configLocation, generateCommand } from "./commands/index.js";

const USAGE = `Usage: seampact <command> [options]

Commands:
  compile [--config <path>] [--out <dir>]  Compile the contract sources the app config's targets use.
  generate [--config <path>]               Generate every target entry of the app config.
`;

// The commands and flags of the CLI design that are not available yet; each answers with exit code 2.
const WAITING_COMMANDS: ReadonlySet<string> = new Set([
  "init",
  "check",
  "lint",
  "diff",
  "bundle",
  "explain",
]);
const WAITING_FLAGS: ReadonlySet<string> = new Set([
  "--watch",
  "--strict",
  "--editor-schemas",
  "--source-map",
]);

const HELP_ARGUMENTS: ReadonlySet<string> = new Set(["help", "--help", "-h"]);

// Runs one CLI command. `argv` holds the arguments after the program name; the result is the exit code: 0 when
// everything was written, 1 on a refusal or a compile error, 2 on a usage error.
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined) return usageError(io, "No command given.");

  if (HELP_ARGUMENTS.has(command)) {
    io.stdout(USAGE);

    return 0;
  }

  if (WAITING_COMMANDS.has(command)) return notAvailable(io, `The command '${command}'`);

  const waitingFlag = rest.find((argument) =>
    WAITING_FLAGS.has(argument.split("=")[0] ?? argument),
  );

  if (waitingFlag !== undefined) return notAvailable(io, `The flag '${waitingFlag}'`);

  if (command === "compile") return runCompile(rest, io);

  if (command === "generate") return runGenerate(rest, io);

  return usageError(io, `Unknown command '${command}'.`);
}

async function runCompile(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCommandArgs(args, { config: { type: "string" }, out: { type: "string" } });

  if (parsed.status === "refused") return usageError(io, parsed.message);

  const { config, out } = parsed.values;

  return compileCommand(configLocation(io.cwd, stringOption(config)), stringOption(out), io);
}

async function runGenerate(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCommandArgs(args, { config: { type: "string" } });

  if (parsed.status === "refused") return usageError(io, parsed.message);

  return generateCommand(configLocation(io.cwd, stringOption(parsed.values.config)), io);
}

type OptionSpec = Record<string, { type: "string" }>;

type ParsedArgs =
  | { status: "parsed"; values: Record<string, string | boolean | undefined> }
  | { status: "refused"; message: string };

function parseCommandArgs(args: readonly string[], options: OptionSpec): ParsedArgs {
  try {
    const { values } = parseArgs({
      args: [...args],
      options,
      strict: true,
      allowPositionals: false,
    });

    return { status: "parsed", values: { ...values } };
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

function stringOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function usageError(io: CliIo, message: string): number {
  const problem: CliProblem = {
    code: "cli.usage",
    message,
    fix: "Run `seampact help` for the commands and their options.",
  };

  printProblems(io, [problem]);
  io.stderr(USAGE);

  return EXIT_USAGE;
}

function notAvailable(io: CliIo, subject: string): number {
  printProblems(io, [
    {
      code: "cli.not-available",
      message: `${subject} is not available yet.`,
      fix: "Use `seampact compile` or `seampact generate`.",
    },
  ]);

  return EXIT_USAGE;
}
