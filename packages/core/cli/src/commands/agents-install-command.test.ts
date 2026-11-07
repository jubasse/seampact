import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS } from "../cli-io.js";
import { runCli } from "../run-cli.js";
import { removeTemporaryDirectories, trackTemporaryDirectory } from "./fake-app.test-support.js";

afterEach(removeTemporaryDirectories);

function makeProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "seampact-agents-"));

  trackTemporaryDirectory(directory);

  return directory;
}

async function run(directory: string, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    cwd: directory,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  const exitCode = await runCli(args, io);

  return { exitCode, out: out.join(""), err: err.join("") };
}

const SKILL_NAMES = [
  "seampact-change-contract",
  "seampact-fix-error",
  "seampact-implement-handler",
  "seampact-setup",
];

test("install writes the block and the four skills into a bare project", async () => {
  const project = makeProject();
  const result = await run(project, ["agents", "install"]);
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");

  expect(result.exitCode).toBe(EXIT_SUCCESS);
  expect(agents).toMatch(/^<!-- seampact:begin \d+\.\d+\.\d+\S* -->\n## seampact\n/);
  expect(agents).toContain("1. `npx seampact lint`");
  expect(agents).toContain("Skills in `.agents/skills/`");
  expect(agents).not.toContain("{{");

  for (const name of SKILL_NAMES)
    expect(existsSync(join(project, ".agents", "skills", name, "SKILL.md"))).toBe(true);

  expect(existsSync(join(project, ".claude"))).toBe(false);
});

test("a second install changes nothing, and keeps the text around the markers", async () => {
  const project = makeProject();

  writeFileSync(join(project, "AGENTS.md"), "# My project\n\nRun the tests.\n");
  await run(project, ["agents", "install"]);

  const first = readFileSync(join(project, "AGENTS.md"), "utf8");

  expect(first.startsWith("# My project\n\nRun the tests.\n\n<!-- seampact:begin")).toBe(true);

  writeFileSync(join(project, "AGENTS.md"), `${first}\n## After\n\nKept.\n`);
  await run(project, ["agents", "install"]);

  const second = readFileSync(join(project, "AGENTS.md"), "utf8");

  expect(second).toBe(`${first}\n## After\n\nKept.\n`);
  expect(second.match(/seampact:begin/g)).toHaveLength(1);
});

test("a second install rewrites an edited block and replaces a skill file, and keeps other skills", async () => {
  const project = makeProject();

  await run(project, ["agents", "install"]);

  const skills = join(project, ".agents", "skills");
  const agentsFile = join(project, "AGENTS.md");

  writeFileSync(agentsFile, readFileSync(agentsFile, "utf8").replace("## seampact", "## edited"));
  writeFileSync(join(skills, "seampact-setup", "SKILL.md"), "edited");
  writeFileSync(join(skills, "seampact-setup", "stale.md"), "stale");
  mkdirSync(join(skills, "my-own-skill"));
  writeFileSync(join(skills, "my-own-skill", "SKILL.md"), "mine");

  await run(project, ["agents", "install"]);

  expect(readFileSync(agentsFile, "utf8")).toContain("## seampact");
  expect(readFileSync(agentsFile, "utf8")).not.toContain("## edited");
  expect(readFileSync(join(skills, "seampact-setup", "SKILL.md"), "utf8")).toContain(
    "name: seampact-setup",
  );
  expect(existsSync(join(skills, "seampact-setup", "stale.md"))).toBe(false);
  expect(readFileSync(join(skills, "my-own-skill", "SKILL.md"), "utf8")).toBe("mine");
});

test("--claude also copies the skills to .claude/skills, --skills-directory moves the first folder", async () => {
  const project = makeProject();
  const result = await run(project, [
    "agents",
    "install",
    "--claude",
    "--skills-directory",
    "tools/skills",
  ]);

  expect(result.exitCode).toBe(EXIT_SUCCESS);
  expect(existsSync(join(project, "tools", "skills", "seampact-fix-error", "SKILL.md"))).toBe(true);
  expect(existsSync(join(project, ".claude", "skills", "seampact-fix-error", "SKILL.md"))).toBe(
    true,
  );
  expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toContain("Skills in `tools/skills/`");
});

test("unbalanced markers are refused before anything is written", async () => {
  const project = makeProject();
  const broken = "# Mine\n\n<!-- seampact:begin 1.0.0 -->\nold text, no end marker\n";

  writeFileSync(join(project, "AGENTS.md"), broken);

  const result = await run(project, ["agents", "install"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("agents.markers.unbalanced");
  expect(result.err).toContain("Fix:");
  expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toBe(broken);
  expect(existsSync(join(project, ".agents"))).toBe(false);
});

test("a skills folder outside the project is refused", async () => {
  const result = await run(makeProject(), ["agents", "install", "--skills-directory", "../x"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("agents.skills.outside");
});

test("an unknown subcommand is a usage error", async () => {
  const result = await run(makeProject(), ["agents", "remove"]);

  expect(result.exitCode).toBe(2);
  expect(result.err).toContain("agents install");
});
