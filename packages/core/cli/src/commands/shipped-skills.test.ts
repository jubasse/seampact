import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { type CliIo, EXIT_SUCCESS } from "../cli-io.js";
import { isRecord } from "../is-record.js";
import { runCli } from "../run-cli.js";
import { renderAgentsBlock } from "./agents-block.js";
import { removeTemporaryDirectories, trackTemporaryDirectory } from "./fake-app.test-support.js";

// The skills and the AGENTS block the package ships must stay true: sized for a small context, naming commands and
// error codes that exist, and YAML that the compiler accepts.

afterEach(removeTemporaryDirectories);

const SKILLS_ROOT = new URL("../../skills/", import.meta.url);
const TROUBLESHOOTING_ROOT = new URL("../../../../../docs/troubleshooting/", import.meta.url);
const AGENTS_PAGE = new URL("../../../../../docs/getting-started/06-ai-agents.md", import.meta.url);
const BYTES_PER_TOKEN = 4;
const SKILL_TOKEN_RANGE = { min: 500, max: 900 };
const AGENTS_BLOCK_MAX_LINES = 30;

const skillNames = readdirSync(SKILLS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const skillTexts = skillNames.map((name) => ({
  name,
  text: readFileSync(new URL(`${name}/SKILL.md`, SKILLS_ROOT), "utf8"),
}));
const agentsBlock = readFileSync(new URL("agents-block.md", SKILLS_ROOT), "utf8");
const everyShippedText = [...skillTexts.map((skill) => skill.text), agentsBlock];

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

function backtickedTokens(text: string): string[] {
  const outsideFences = text.replace(/```[\s\S]*?```/g, "");

  return [...outsideFences.matchAll(/`([^`\n]+)`/g)].flatMap((match) => match[1] ?? []);
}

test("the package ships the four skills", () => {
  expect(skillNames.sort()).toEqual([
    "seampact-change-contract",
    "seampact-fix-error",
    "seampact-implement-handler",
    "seampact-setup",
  ]);
});

test.each(skillTexts)("$name has a name, a description and 500 to 900 tokens", ({ name, text }) => {
  const frontmatter = /^---\nname: (\S+)\ndescription: (.+)\n---\n/.exec(text);
  const tokens = Math.ceil(Buffer.byteLength(text) / BYTES_PER_TOKEN);

  expect(frontmatter?.[1]).toBe(name);
  expect(frontmatter?.[2]?.length).toBeGreaterThan(100);
  expect(tokens).toBeGreaterThanOrEqual(SKILL_TOKEN_RANGE.min);
  expect(tokens).toBeLessThanOrEqual(SKILL_TOKEN_RANGE.max);
});

test("the AGENTS block stays under 30 lines", () => {
  expect(agentsBlock.trimEnd().split("\n").length).toBeLessThan(AGENTS_BLOCK_MAX_LINES);
});

test("every reference a skill names exists in its folder", () => {
  for (const { name, text } of skillTexts) {
    const named = [...text.matchAll(/`(references\/[\w-]+\.md)`/g)].map((match) => match[1]);

    for (const path of named)
      expect(() => readFileSync(new URL(`${name}/${path}`, SKILLS_ROOT))).not.toThrow();
  }
});

test("the agent page shows the AGENTS block the install command writes on Node", () => {
  const block = renderAgentsBlock(agentsBlock, {
    seampact: "npx seampact",
    skillsDirectory: ".agents/skills",
  });

  expect(readFileSync(AGENTS_PAGE, "utf8")).toContain(block);
});

// A command span: `npx seampact diff --against <baseline>`, or an unprefixed `diff --against x` once `diff` is known.
const PREFIXED_COMMAND = /`(?:npx seampact|\{\{seampact\}\}|seampact) (\w+)([^`]*)`/g;
const UNPREFIXED_COMMAND = /`(\w+)( --[^`]*)`/g;

test("every seampact command and flag a skill names is in the CLI usage", async () => {
  const usage = (await run(tmpdir(), ["help"])).out;
  const usageLineOf = new Map(
    [...usage.matchAll(/^ {2}(\w+) (.*)$/gm)].map((match) => [match[1], match[2] ?? ""]),
  );
  const prefixed = everyShippedText.flatMap((text) => [...text.matchAll(PREFIXED_COMMAND)]);
  const unprefixed = everyShippedText
    .flatMap((text) => [...text.matchAll(UNPREFIXED_COMMAND)])
    .filter((match) => usageLineOf.has(match[1] ?? ""));
  const named = [...prefixed, ...unprefixed];

  expect(prefixed.length).toBeGreaterThan(5);
  expect(unprefixed.length).toBeGreaterThan(0);

  for (const [span, command = "", rest = ""] of named) {
    const usageLine = usageLineOf.get(command);

    expect(usageLine, span).toBeDefined();

    for (const [flag] of rest.matchAll(/--[\w-]+/g)) expect(usageLine, span).toContain(flag);
  }
});

test("every error code a skill names is in the troubleshooting pages", () => {
  const troubleshooting = readdirSync(TROUBLESHOOTING_ROOT)
    .filter((file) => file.endsWith(".md"))
    .map((file) => readFileSync(new URL(file, TROUBLESHOOTING_ROOT), "utf8"))
    .join("\n");
  const codes = everyShippedText
    .flatMap(backtickedTokens)
    .filter((token) => /^[a-z]+(?:\.[A-Za-z<>]+)+$/.test(token))
    .filter((token) => !/\.(?:yaml|yml|md|json|ts|toml|xml|txt)$/.test(token))
    .filter((token) => !token.startsWith("request."));

  expect(codes).toContain("check.generated.drift");

  for (const code of codes) expect(troubleshooting).toContain(`\`${code}\``);
});

test("every YAML snippet of a skill compiles inside the starter contract", async () => {
  const snippets = skillTexts.flatMap(({ text }) =>
    [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].flatMap((match) => match[1] ?? []),
  );

  expect(snippets.length).toBeGreaterThanOrEqual(2);

  for (const snippet of snippets) {
    const project = mkdtempSync(join(tmpdir(), "seampact-skill-yaml-"));

    trackTemporaryDirectory(project);
    expect((await run(project, ["init"])).exitCode).toBe(EXIT_SUCCESS);

    const contractFile = join(project, "contract", "api.yaml");
    const contract: unknown = parse(readFileSync(contractFile, "utf8"));

    writeFileSync(contractFile, stringify(withSnippet(contract, snippet)));

    const compiled = await run(project, ["compile"]);

    expect(compiled.err, snippet).toBe("");
    expect(compiled.exitCode, snippet).toBe(EXIT_SUCCESS);
  }
});

// A snippet whose first line says "under surfaces.app.routes" is a route; any other is a top-level block.
function withSnippet(contract: unknown, snippet: string): unknown {
  if (!isRecord(contract)) throw new Error("The starter contract is not a mapping.");

  const parsed: unknown = parse(snippet);

  if (!isRecord(parsed)) throw new Error("A skill YAML snippet is not a mapping.");

  if (!snippet.startsWith("# contract/api.yaml, under surfaces.app.routes"))
    return { ...contract, ...parsed };

  const surfaces = contract.surfaces;

  if (!isRecord(surfaces) || !isRecord(surfaces.app) || !isRecord(surfaces.app.routes))
    throw new Error("The starter contract has no surfaces.app.routes.");

  return {
    ...contract,
    surfaces: {
      ...surfaces,
      app: { ...surfaces.app, routes: { ...surfaces.app.routes, ...parsed } },
    },
  };
}
