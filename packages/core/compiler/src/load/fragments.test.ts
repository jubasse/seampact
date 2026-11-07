import { join } from "node:path";
import { expect, test } from "vitest";
import { FIXTURES } from "./golden.js";
import { loadFsReader, loadWorkspace } from "./index.js";
import { loadMemoryReader } from "./reader.js";

// ADR 0002 section 3: a fragment's kind is the one its include site expects.
const REFERENCE = join(FIXTURES, "../reference");

function kindsOf(files: Record<string, string>, entry = "api.yaml") {
  const result = loadWorkspace({ reader: loadMemoryReader(files), entry });

  expect(result.diagnostics).toEqual([]);

  return result.fragments.map(({ file, pointer, kind }) => ({ file, pointer, kind }));
}

test("the reference workspace's fragments are two schema catalogues and a tree node", () => {
  const result = loadWorkspace({ reader: loadFsReader(REFERENCE), entry: "workspace.yaml" });

  expect(result.fragments.map(({ file, kind, at }) => [file, kind, at.file])).toEqual([
    ["shared/schemas.yaml", "schemas", "shared/base.yaml"],
    ["tasks/routes/tasks/search.yaml", "node", "tasks/api.yaml"],
    ["tasks/schemas.yaml", "schemas", "tasks/api.yaml"],
  ]);
});

test("each include site gives its own kind: a base file, a catalogue, conventions, a node's errors, a schema", () => {
  const kinds = kindsOf(
    {
      "workspace.yaml": "workspace:\n  apis:\n    a: ./api.yaml\n  shared: ./base.yaml\n",
      "base.yaml": "$include: ./base-part.yaml\n",
      "base-part.yaml": "scalars: { Id: { type: string } }\n",
      "api.yaml": [
        "api: { name: a, version: 1 }",
        "rights: { $include: ./rights.yaml }",
        "conventions: { $include: ./conventions.yaml }",
        "schemas:",
        "  Task: { $include: ./task.yaml }",
        "surfaces:",
        "  public:",
        "    routes:",
        "      tasks:",
        "        method: get",
        "        output: { $ref: ./shared.yaml#/Note }",
        "        errors: { $include: ./errors.yaml }",
        "",
      ].join("\n"),
      "rights.yaml": "tasks.read: {}\n",
      "conventions.yaml": "pathVersion: none\n",
      "task.yaml": "type: object\n",
      "shared.yaml": "Note: { type: string }\n",
      "errors.yaml": "{}\n",
    },
    "workspace.yaml",
  );

  expect(kinds).toEqual([
    { file: "base-part.yaml", pointer: undefined, kind: "base" },
    { file: "conventions.yaml", pointer: undefined, kind: "conventions" },
    { file: "errors.yaml", pointer: undefined, kind: "node-errors" },
    { file: "rights.yaml", pointer: undefined, kind: "rights" },
    { file: "shared.yaml", pointer: "/Note", kind: "schemas" },
    { file: "task.yaml", pointer: undefined, kind: "schema" },
  ]);
});

test("an include at the root of an entry file read as a workspace or an api names no kind", () => {
  const kinds = kindsOf(
    {
      "workspace.yaml": "$include: ./ws.yaml\n",
      "ws.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n",
      "a.yaml": "api: { name: a, version: 1 }\n",
    },
    "workspace.yaml",
  );

  expect(kinds).toEqual([{ file: "ws.yaml", pointer: undefined, kind: undefined }]);
});
