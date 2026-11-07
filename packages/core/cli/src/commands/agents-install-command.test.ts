import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

test.each([["../x"], [""], ["."]])(
  "the skills folder '%s', outside the project or the project itself, is refused",
  async (directory) => {
    const project = makeProject();
    const result = await run(project, ["agents", "install", "--skills-directory", directory]);

    expect(result.exitCode).toBe(EXIT_REFUSED);
    expect(result.err).toContain("agents.skills.outside");
    expect(readdirSync(project)).toEqual([]);
  },
);

test("an AGENTS.md that is a symbolic link is refused, and its target is left alone", async () => {
  const project = makeProject();
  const outside = join(makeProject(), "AGENTS.md");

  writeFileSync(outside, "outside\n");
  symlinkSync(outside, join(project, "AGENTS.md"));

  const result = await run(project, ["agents", "install"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("agents.symlink");
  expect(readFileSync(outside, "utf8")).toBe("outside\n");
  expect(existsSync(join(project, ".agents"))).toBe(false);
});

test.each([
  ["a symbolic link to .agents", ".agents", ".agents/skills"],
  ["a symbolic link to a folder on the way to --skills-directory", "link", "link/skills"],
  ["a symbolic link to the skills folder", ".claude/skills", ".claude/skills"],
])("%s outside the project is refused before any write", async (_case, linkPath, directory) => {
  const project = makeProject();
  const outside = makeProject();

  mkdirSync(join(project, linkPath, ".."), { recursive: true });
  symlinkSync(outside, join(project, linkPath));

  const result = await run(project, ["agents", "install", "--skills-directory", directory]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("agents.symlink");
  expect(readdirSync(outside)).toEqual([]);
  expect(existsSync(join(project, "AGENTS.md"))).toBe(false);
});

test("a seampact skill folder that is a symbolic link is refused, and its target is not deleted", async () => {
  const project = makeProject();
  const outside = makeProject();

  writeFileSync(join(outside, "keep.md"), "keep");
  mkdirSync(join(project, ".agents", "skills"), { recursive: true });
  symlinkSync(outside, join(project, ".agents", "skills", "seampact-setup"));

  const result = await run(project, ["agents", "install"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("agents.symlink");
  expect(readdirSync(outside)).toEqual(["keep.md"]);
});

test("a failed copy leaves the skills and AGENTS.md as they were", async () => {
  const project = makeProject();

  await run(project, ["agents", "install"]);

  const agentsFile = join(project, "AGENTS.md");
  const skills = join(project, ".agents", "skills");
  const edited = `${readFileSync(agentsFile, "utf8")}\nMine.\n`;

  writeFileSync(agentsFile, edited);
  writeFileSync(join(skills, "seampact-setup", "SKILL.md"), "edited");
  writeFileSync(join(project, ".claude"), "a file where the folder should be");

  const result = await run(project, ["agents", "install", "--claude"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("agents.install.failed");
  expect(readFileSync(agentsFile, "utf8")).toBe(edited);
  expect(readFileSync(join(skills, "seampact-setup", "SKILL.md"), "utf8")).toBe("edited");
  expect(readdirSync(skills).sort()).toEqual(SKILL_NAMES);
});

test("a seampact skill no longer shipped is removed, and the block names the version it replaced", async () => {
  const project = makeProject();
  const skills = join(project, ".agents", "skills");

  mkdirSync(join(skills, "seampact-dropped"), { recursive: true });
  writeFileSync(
    join(project, "AGENTS.md"),
    "<!-- seampact:begin 0.0.1 -->\nold\n<!-- seampact:end -->\n",
  );

  const result = await run(project, ["agents", "install"]);

  expect(result.exitCode).toBe(EXIT_SUCCESS);
  expect(readdirSync(skills).sort()).toEqual(SKILL_NAMES);
  expect(result.out).toContain("replaced the block of seampact 0.0.1 with");
});

test("markers shown in a code fence of the user's file are kept as text", async () => {
  const project = makeProject();
  const example =
    "# Mine\n\n```md\n<!-- seampact:begin 1.0.0 -->\nexample\n<!-- seampact:end -->\n```\n";

  writeFileSync(join(project, "AGENTS.md"), example);

  const result = await run(project, ["agents", "install"]);
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");

  expect(result.exitCode).toBe(EXIT_SUCCESS);
  expect(agents.startsWith(example)).toBe(true);
  expect(agents).toContain("## seampact");
});

test("an unknown subcommand is a usage error", async () => {
  const result = await run(makeProject(), ["agents", "remove"]);

  expect(result.exitCode).toBe(2);
  expect(result.err).toContain("agents install");
});
