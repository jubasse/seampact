import { expect, test } from "vitest";
import { type CliIo, EXIT_SUCCESS, EXIT_USAGE, runCli } from "./index.js";

async function run(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    cwd: process.cwd(),
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  const exitCode = await runCli(args, io);

  return { exitCode, out: out.join(""), err: err.join("") };
}

const COMMANDS = ["init", "compile", "generate", "check", "lint", "diff", "explain", "bundle"];

test.each(["help", "--help", "-h"])("%s prints every command and exits 0", async (argument) => {
  const result = await run([argument]);

  expect(result.exitCode).toBe(EXIT_SUCCESS);

  for (const command of COMMANDS) expect(result.out).toContain(`  ${command} `);
});

test("no command is a usage error that prints the usage", async () => {
  const result = await run([]);

  expect(result.exitCode).toBe(EXIT_USAGE);
  expect(result.err).toContain("cli.usage");
  expect(result.err).toContain("Usage: seampact <command>");
});

test("an unknown command is a usage error that names it", async () => {
  const result = await run(["frobnicate"]);

  expect(result.exitCode).toBe(EXIT_USAGE);
  expect(result.err).toContain("Unknown command 'frobnicate'");
});

test.each(["--watch", "--strict", "--source-map"])(
  "the flag %s that is not available yet exits 2 and says so",
  async (flag) => {
    const result = await run(["compile", flag]);

    expect(result.exitCode).toBe(EXIT_USAGE);
    expect(result.err).toContain("cli.not-available");
  },
);

test("an unknown option of a command is a usage error", async () => {
  const result = await run(["lint", "--no-such-option"]);

  expect(result.exitCode).toBe(EXIT_USAGE);
  expect(result.err).toContain("cli.usage");
});
