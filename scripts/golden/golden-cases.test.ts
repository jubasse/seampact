import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "./compiler.ts";
import { GOLDEN_DIRECTORY } from "./golden.ts";
import { REPO_ROOT } from "./repo-root.ts";

// What the committed golden IR of each case shows, read from the files `scripts/golden --check` keeps current.

function readIr(path: string): JsonObject {
  return JSON.parse(readFileSync(join(REPO_ROOT, GOLDEN_DIRECTORY, path), "utf8"));
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function operationNamed(ir: JsonObject, id: string): JsonObject {
  const operation = objects(ir.operations).find((each) => each.id === id);

  if (operation === undefined) throw new Error(`the IR holds no operation ${id}`);

  return operation;
}

function member(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function wireKinds(fields: unknown): Record<string, unknown> {
  return Object.fromEntries(
    objects(fields).map((field) => [field.name, member(field.wire, "kind")]),
  );
}

describe("bodies golden case", () => {
  const ir = readIr("bodies/notes.ir.json");

  it("holds query fields with their wire", () => {
    const list = operationNamed(ir, "listNotes");
    const query = member(list.params, "query");

    expect(wireKinds(query)).toEqual({
      state: "text",
      labels: "list",
      range: "object",
      archived: "boolean",
      minWords: "number",
      cursor: "text",
      limit: "number",
      sort: "list",
    });
  });

  it("holds form and multipart fields with their wire", () => {
    expect(wireKinds(member(operationNamed(ir, "feedbackNotes").input, "fields"))).toEqual({
      message: "text",
      score: "number",
      subscribe: "boolean",
      tags: "list",
    });
    expect(wireKinds(member(operationNamed(ir, "attachNotes").input, "fields"))).toEqual({
      file: "file",
      caption: "text",
      meta: "json",
    });
  });

  it("guards a sort key with a right whose subject is the scope", () => {
    const sortKeys = objects(member(operationNamed(ir, "listNotes").paging, "sortKeys"));
    const restricted = sortKeys.find((key) => key.key === "wordCount");

    expect(sortKeys.map((key) => key.key)).toEqual(["createdAt", "wordCount"]);
    expect(restricted?.right).toBe("notes.seeWordCount");
    expect(restricted?.subject).toEqual({ source: { in: "scope", name: "space" } });
  });
});

describe("every-default golden case", () => {
  const ir = readIr("every-default/ledger.ir.json");
  const text = readFileSync(
    join(REPO_ROOT, GOLDEN_DIRECTORY, "every-default/ledger.ir.json"),
    "utf8",
  );

  it("every default is overridable", () => {
    const conventions = ir.conventions;

    // Every convention the IR holds is one the contract wrote: none carries a core default.
    for (const [name, convention] of Object.entries(isObject(conventions) ? conventions : {})) {
      expect(member(member(convention, "origin"), "layer"), name).toBe("api");
    }

    expect(member(ir.conventions, "format")).toMatchObject({ value: "house" });
    expect(Object.keys(isObject(ir.formats) ? ir.formats : {})).toEqual(["house"]);
    expect(text).not.toMatch(
      /"bare"|"api\.[a-z_]+"|"Deprecation"|"Sunset"|\/v\{?(?:ersion|\d+)\}?/,
    );
    expect(
      Object.keys(isObject(ir.errors) ? ir.errors : {}).every((code) => code.startsWith("err.")),
    ).toBe(true);
    expect(
      objects(ir.operations).map((operation) => [operation.id, operation.method, operation.path]),
    ).toEqual([
      ["entries_batch_get", "post", "/entries/lookup"],
      ["entries_list", "get", "/entries"],
      ["entry_closing_balance", "get", "/entries/{entryId}/closing_balance"],
      ["entry_create", "post", "/entries"],
      ["entry_delete", "delete", "/entries/{entryId}"],
      ["entry_get", "get", "/entries/{entryId}"],
      ["entry_update", "put", "/entries/{entryId}"],
    ]);
  });

  it("uses no opt-in", () => {
    expect(ir.packs).toEqual([]);
    expect(member(ir.conventions, "idempotency.header")).toBeUndefined();

    for (const operation of objects(ir.operations)) {
      expect(operation.csrf, String(operation.id)).toBeUndefined();
      expect(operation.idempotency, String(operation.id)).toBeUndefined();
    }
  });
});

function goldenFilePaths(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    return statSync(path).isDirectory() ? goldenFilePaths(path) : [path];
  });
}

describe("golden files", () => {
  const environmentValues = [REPO_ROOT, homedir(), hostname(), userInfo().username].filter(
    (value) => value.length > 3,
  );
  const files = goldenFilePaths(join(REPO_ROOT, GOLDEN_DIRECTORY)).filter((path) =>
    /\.(?:ir|source-map)\.json$/.test(path),
  );

  it("golden files hold no environment value", () => {
    expect(files.length).toBeGreaterThan(0);

    for (const path of files) {
      const content = readFileSync(path, "utf8");
      const name = relative(REPO_ROOT, path);

      for (const value of environmentValues) expect(content, name).not.toContain(value);

      expect(content, name).not.toMatch(/[A-Za-z]:\\|\r|\/home\/|\/Users\/|\/tmp\//);
    }
  });
});
