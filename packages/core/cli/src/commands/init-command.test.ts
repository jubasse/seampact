import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, EXIT_USAGE } from "../cli-io.js";
import { runCli } from "../run-cli.js";
import {
  REFERENCE_WORKSPACE,
  removeTemporaryDirectories,
  trackTemporaryDirectory,
} from "./fake-app.test-support.js";

afterEach(() => {
  removeTemporaryDirectories();
  vi.unstubAllEnvs();
});

async function run(
  directory: string,
  args: string[],
): Promise<{ exitCode: number; out: string; err: string }> {
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

function emptyDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "seampact-init-"));

  trackTemporaryDirectory(directory);

  return directory;
}

function text(directory: string, file: string): string {
  return readFileSync(join(directory, file), "utf8");
}

const CONTRACT = "contract/api.yaml";
const NODE_SCHEMA = "contract/.seampact/schemas/node.schema.json";

test("init writes a project whose example contract compiles, with its modeline, editor schemas and ignore entry", async () => {
  const app = emptyDirectory();
  const init = await run(app, ["init"]);

  expect(init.err).toBe("");
  expect(init.exitCode).toBe(EXIT_SUCCESS);
  expect(init.out).toContain("Created seampact.config.yaml.");
  expect(init.out).toContain(`Created ${CONTRACT}.`);
  expect(init.out).toContain("Created .gitignore.");
  expect(text(app, CONTRACT).split("\n")[0]).toBe(
    "# yaml-language-server: $schema=.seampact/schemas/api.schema.json",
  );
  expect(text(app, CONTRACT)).toContain("list: {");
  expect(existsSync(join(app, NODE_SCHEMA))).toBe(true);
  expect(text(app, ".gitignore")).toBe(".seampact/\n");

  const compiled = await run(app, ["compile"]);

  expect(compiled.err).toBe("");
  expect(compiled.out).toBe("Compiled 1 api(s) without error.\n");
});

test("init --blank writes the api header alone, which compiles", async () => {
  const app = emptyDirectory();

  expect((await run(app, ["init", "--blank"])).exitCode).toBe(EXIT_SUCCESS);
  expect(text(app, CONTRACT)).not.toContain("surfaces:");
  expect((await run(app, ["compile"])).out).toBe("Compiled 1 api(s) without error.\n");
});

test("init refuses by name when a file it would write exists, and writes nothing", async () => {
  const app = emptyDirectory();

  writeFileSync(join(app, "seampact.config.yaml"), "sources: {}\n");

  const init = await run(app, ["init"]);

  expect(init.exitCode).toBe(EXIT_REFUSED);
  expect(init.err).toMatch(/^init\.file-exists: .*seampact\.config\.yaml already exists/);
  expect(existsSync(join(app, "contract"))).toBe(false);
  expect(existsSync(join(app, ".gitignore"))).toBe(false);
});

test("the ignore entry is appended once to an existing .gitignore", async () => {
  const app = emptyDirectory();

  writeFileSync(join(app, ".gitignore"), "node_modules");
  await run(app, ["init"]);

  expect(text(app, ".gitignore")).toBe("node_modules\n.seampact/\n");

  const again = await run(app, ["init", "--modelines"]);

  expect(again.exitCode).toBe(EXIT_SUCCESS);
  expect(again.out).not.toContain(".gitignore");
  expect(text(app, ".gitignore")).toBe("node_modules\n.seampact/\n");
});

test("--editor-schemas=none points the modeline at the installed spec and writes no schema nor ignore entry", async () => {
  const app = emptyDirectory();

  expect((await run(app, ["init", "--editor-schemas=none"])).exitCode).toBe(EXIT_SUCCESS);
  expect(text(app, CONTRACT).split("\n")[0]).toBe(
    "# yaml-language-server: $schema=../node_modules/@seampact/spec/schemas/authoring/api.schema.json",
  );
  expect(existsSync(join(app, "contract/.seampact"))).toBe(false);
  expect(existsSync(join(app, ".gitignore"))).toBe(false);
});

test("--no-modelines and --no-ignore-files leave the modeline and the ignore file out", async () => {
  const app = emptyDirectory();

  await run(app, ["init", "--no-modelines", "--no-ignore-files"]);

  expect(text(app, CONTRACT)).not.toContain("yaml-language-server");
  expect(existsSync(join(app, NODE_SCHEMA))).toBe(true);
  expect(existsSync(join(app, ".gitignore"))).toBe(false);
});

test("init --modelines writes or corrects every file's modeline from the kind its include site expects", async () => {
  const app = emptyDirectory();

  cpSync(REFERENCE_WORKSPACE, join(app, "contract"), { recursive: true });
  writeFileSync(join(app, "seampact.config.yaml"), "sources:\n  contract: { path: ./contract }\n");
  writeFileSync(
    join(app, "contract/tasks/api.yaml"),
    `# yaml-language-server: $schema=elsewhere.json\n${text(app, "contract/tasks/api.yaml")}`,
  );

  const init = await run(app, ["init", "--modelines", "--editor-schemas=commit"]);

  expect(init.err).toBe("");
  expect(init.exitCode).toBe(EXIT_SUCCESS);
  expect(init.out).toContain(
    "Left contract/tasks/examples/search-200.json without a modeline: not a YAML file, so it holds no comment.",
  );
  expect(text(app, "contract/tasks/routes/tasks/search.yaml").split("\n")[0]).toBe(
    "# yaml-language-server: $schema=../../../.seampact/schemas/node.schema.json",
  );
  expect(text(app, "contract/tasks/api.yaml").split("\n").slice(0, 2)).toEqual([
    "# yaml-language-server: $schema=../.seampact/schemas/api.schema.json",
    "# tasks/api.yaml",
  ]);
  expect(text(app, "contract/workspace.yaml").split("\n")[0]).toBe(
    "# yaml-language-server: $schema=.seampact/schemas/workspace.schema.json",
  );
  expect(text(app, "contract/shared/base.yaml").split("\n")[0]).toBe(
    "# yaml-language-server: $schema=../.seampact/schemas/base.schema.json",
  );
  expect(text(app, "contract/tasks/schemas.yaml").split("\n")[0]).toBe(
    "# yaml-language-server: $schema=../.seampact/schemas/schemas.schema.json",
  );
  expect(existsSync(join(app, "contract/.seampact/schemas/node.schema.json"))).toBe(true);
  expect(existsSync(join(app, ".gitignore"))).toBe(false);
  expect((await run(app, ["init", "--modelines"])).out).toContain(
    "Every modeline was already right.",
  );
});

test("init flags that do not go together are usage errors", async () => {
  const app = emptyDirectory();

  for (const args of [
    ["init", "--editor-schemas=sometimes"],
    ["init", "--modelines", "--blank"],
    ["init", "--config", "other.yaml"],
  ]) {
    const init = await run(app, args);

    expect(init.exitCode).toBe(EXIT_USAGE);
    expect(init.err).toMatch(/^cli\.usage: /);
  }

  expect(existsSync(join(app, "seampact.config.yaml"))).toBe(false);
});

test("a dangling link where the config goes is refused by name, and nothing is written through it", async () => {
  const app = emptyDirectory();
  const elsewhere = emptyDirectory();

  symlinkSync(join(elsewhere, "seampact.config.yaml"), join(app, "seampact.config.yaml"));

  const init = await run(app, ["init"]);

  expect(init.exitCode).toBe(EXIT_REFUSED);
  expect(init.err).toMatch(/^init\.file-exists: /);
  expect(readdirSync(elsewhere)).toEqual([]);
  expect(readdirSync(app)).toEqual(["seampact.config.yaml"]);
});

test("an existing contract folder is refused, whatever it holds", async () => {
  const app = emptyDirectory();

  mkdirSync(join(app, "contract"));
  writeFileSync(join(app, "contract", "workspace.yaml"), "workspace: {}\n");

  const init = await run(app, ["init"]);

  expect(init.err).toMatch(/^init\.file-exists: .*contract already exists/);
  expect(existsSync(join(app, "seampact.config.yaml"))).toBe(false);
});

test("a .gitignore that is a symbolic link is refused by name before any write", async () => {
  const app = emptyDirectory();
  const elsewhere = emptyDirectory();

  writeFileSync(join(elsewhere, "ignored"), "dist\n");
  symlinkSync(join(elsewhere, "ignored"), join(app, ".gitignore"));

  const init = await run(app, ["init"]);

  expect(init.exitCode).toBe(EXIT_REFUSED);
  expect(init.err).toMatch(/^init\.ignore-file-link: /);
  expect(readFileSync(join(elsewhere, "ignored"), "utf8")).toBe("dist\n");
  expect(readdirSync(app)).toEqual([".gitignore"]);
  expect(lstatSync(join(app, ".gitignore")).isSymbolicLink()).toBe(true);
});

test("init refuses by name where local sources are refused, and writes nothing", async () => {
  const app = emptyDirectory();

  vi.stubEnv("SEAMPACT_ALLOW_LOCAL", "false");

  const init = await run(app, ["init"]);

  expect(init.exitCode).toBe(EXIT_REFUSED);
  expect(init.err).toMatch(/^init\.local-sources-refused: .*SEAMPACT_ALLOW_LOCAL=false/);
  expect(readdirSync(app)).toEqual([]);
});

test("init --modelines refuses an app config without a path source", async () => {
  const app = emptyDirectory();

  writeFileSync(
    join(app, "seampact.config.yaml"),
    "sources:\n  notes: { package: '@acme/notes', version: 1.0.0 }\n",
  );

  const init = await run(app, ["init", "--modelines"]);

  expect(init.exitCode).toBe(EXIT_REFUSED);
  expect(init.err).toMatch(/^init\.modelines\.no-source: /);
});

test("a failure after the first write removes what init wrote", async () => {
  const parent = emptyDirectory();
  const app = join(parent, "app");

  mkdirSync(app);
  writeFileSync(join(parent, "seampact.config.yaml"), "apps: [app\n");

  const init = await run(app, ["init"]);

  expect(init.exitCode).toBe(EXIT_REFUSED);
  expect(init.err).toContain("init left nothing behind");
  expect(readdirSync(app)).toEqual([]);
});
