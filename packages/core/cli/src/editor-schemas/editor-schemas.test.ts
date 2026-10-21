import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { AUTHORING_FILES, authoringSchemaFileName } from "@seampact/spec/authoring";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, expect, test } from "vitest";
import { parse } from "yaml";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS } from "../cli-io.js";
import {
  makeApp,
  removeTemporaryDirectories,
  trackTemporaryDirectory,
} from "../commands/fake-app.test-support.js";
import { runCli } from "../run-cli.js";
import { editorNames } from "./editor-names.js";
import { DEFAULT_EDITOR_SCHEMAS_DIRECTORY } from "./index.js";
import { editorSchemaFiles } from "./specialise.js";

afterEach(removeTemporaryDirectories);

// Grammar section 3 and SCN-110: `compile --editor-schemas` writes the authoring schemas specialised for the
// workspace, so an editor flags a misspelt name.

const CONFIG =
  "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n";
const TARGETS = [
  { name: "fake-server", role: "server" as const, files: [{ path: "a.ts", contents: "" }] },
];
const BASE_URI = "https://seampact.invalid/editor/";

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

function makeReferenceApp(): string {
  const app = makeApp(CONFIG, TARGETS);

  trackTemporaryDirectory(app);

  return app;
}

function readSchemas(directory: string): Map<string, string> {
  return new Map(
    readdirSync(directory)
      .sort()
      .map((file) => [file, readFileSync(join(directory, file), "utf8")]),
  );
}

// The written node schema, with the files it references, checking one route fragment.
function nodeValidator(directory: string) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });

  for (const [file, text] of readSchemas(directory))
    ajv.addSchema({ ...JSON.parse(text), $id: BASE_URI + file });

  const validate = ajv.getSchema(`${BASE_URI}node.schema.json`);

  if (validate === undefined) throw new Error("no node schema");

  return validate;
}

test("compile --editor-schemas writes every authoring schema, each name position listing the declared names", async () => {
  const app = makeReferenceApp();
  const result = await run(app, ["compile", "--editor-schemas"]);
  const directory = join(app, "a", DEFAULT_EDITOR_SCHEMAS_DIRECTORY);

  expect(result.err).toBe("");
  expect(result.exitCode).toBe(EXIT_SUCCESS);
  expect(result.out).toContain(`Wrote ${AUTHORING_FILES.length} editor schema(s) of source 'a'`);
  expect([...readSchemas(directory).keys()]).toEqual(
    AUTHORING_FILES.map(authoringSchemaFileName).sort(),
  );

  const route = parse(readFileSync(join(app, "a", "tasks/routes/tasks/search.yaml"), "utf8"));
  const validate = nodeValidator(directory);

  expect(validate(route)).toBe(true);
  expect(validate({ ...route, requires: [{ right: "tasks.reed" }] })).toBe(false);
  expect(validate({ ...route, input: "TaskQuerry" })).toBe(false);
  expect(validate({ ...route, input: "./schemas.yaml#/TaskQuery" })).toBe(true);

  const node = readSchemas(directory).get("node.schema.json") ?? "";

  expect(node).toMatch(/"tasks\.read"/);
  expect(node).toMatch(/Declared in tasks\/api\.yaml line \d+\./);
  expect(node).toContain("Supplied by seampact: the default code of the schemaInvalid role.");
});

test("the editor schemas are the same bytes on a second run", async () => {
  const app = makeReferenceApp();
  const directory = join(app, "a", DEFAULT_EDITOR_SCHEMAS_DIRECTORY);

  await run(app, ["compile", "--editor-schemas"]);
  const first = readSchemas(directory);

  await run(app, ["compile", "--editor-schemas"]);

  expect(readSchemas(directory)).toEqual(first);
});

test("workspace.editorSchemas names the directory, and one outside the workspace root is refused", async () => {
  const app = makeReferenceApp();
  const workspaceFile = join(app, "a", "workspace.yaml");
  const workspace = readFileSync(workspaceFile, "utf8");

  writeFileSync(workspaceFile, `${workspace}  editorSchemas: editor/schemas\n`);
  expect((await run(app, ["compile", "--editor-schemas"])).exitCode).toBe(EXIT_SUCCESS);
  expect(existsSync(join(app, "a", "editor/schemas/node.schema.json"))).toBe(true);

  writeFileSync(workspaceFile, `${workspace}  editorSchemas: ../outside\n`);
  const refused = await run(app, ["compile", "--editor-schemas"]);

  expect(refused.exitCode).toBe(EXIT_REFUSED);
  expect(refused.err).toContain("compile.editor-schemas.outside");
  expect(existsSync(join(app, "outside"))).toBe(false);
});

test("a compile error writes no editor schema", async () => {
  const app = makeReferenceApp();

  writeFileSync(join(app, "a", "tasks", "schemas.yaml"), "Broken: { type: nope }\n", { flag: "a" });
  const result = await run(app, ["compile", "--editor-schemas"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(existsSync(join(app, "a", DEFAULT_EDITOR_SCHEMAS_DIRECTORY))).toBe(false);
});

test("a symlinked schema directory is refused and nothing is written outside the root, the IR included", async () => {
  const app = makeReferenceApp();
  const outside = join(app, "outside");

  mkdirSync(outside);
  symlinkSync(outside, join(app, "a", ".seampact"));
  const result = await run(app, ["compile", "--editor-schemas", "--out", "ir"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("compile.editor-schemas.outside");
  expect(readdirSync(outside)).toEqual([]);
  expect(existsSync(join(app, "ir"))).toBe(false);
});

test("a symlinked schema file is refused and its target is left alone", async () => {
  const app = makeReferenceApp();
  const target = join(app, "precious.txt");
  const directory = join(app, "a", DEFAULT_EDITOR_SCHEMAS_DIRECTORY);

  writeFileSync(target, "keep");
  mkdirSync(directory, { recursive: true });
  symlinkSync(target, join(directory, "node.schema.json"));
  const result = await run(app, ["compile", "--editor-schemas"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("compile.editor-schemas.outside");
  expect(readFileSync(target, "utf8")).toBe("keep");
});

test("a role's bound code is a name position, listing the declared and core codes", async () => {
  const app = makeReferenceApp();
  const directory = join(app, "a", DEFAULT_EDITOR_SCHEMAS_DIRECTORY);

  await run(app, ["compile", "--editor-schemas"]);
  const conventions = JSON.parse(readSchemas(directory).get("conventions.schema.json") ?? "{}");
  const binding = conventions.$defs.roleBinding;

  expect(binding.then.enum).toContain("api.internal");
  expect(binding.else.then.properties.code.enum).toContain("api.internal");
});

test("an empty catalogue leaves its position keyword-only, not an empty enum", () => {
  const files = editorSchemaFiles(new Map());

  for (const file of files) expect(file.text).not.toContain('"enum": []');
});

test("a pack's names are described by the pack, not by its install path", () => {
  const names = editorNames([
    {
      catalogue: "rights",
      name: "page.read",
      file: "../../node_modules/@seampact/pack-api-platform/pack.yaml",
      line: 4,
    },
  ]);

  expect(names.get("rights")?.get("page.read")).toBe(
    "Declared in the pack @seampact/pack-api-platform.",
  );
});
