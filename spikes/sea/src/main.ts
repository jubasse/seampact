// Stand-in for the seampact compiler (ADR 0010): reads a small YAML workspace through an
// injected reader, refuses anchors, prints a canonical JSON value and its SHA-256.
// Node APIs used: fs, path, crypto, and process (argv, stdout, stderr, exit code).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isAlias, LineCounter, parseDocument, visit } from "yaml";

interface Reader {
  list(dir: string): string[];
  read(file: string): string;
}

const fsReader: Reader = {
  list: (dir) => readdirSync(dir).sort(),
  read: (file) => readFileSync(file, "utf8"),
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

class CompileError extends Error {}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k] as Json)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compile(reader: Reader, dir: string): Json {
  const files: { [name: string]: Json } = {};
  for (const name of reader.list(dir)) {
    if (!name.endsWith(".yaml")) continue;
    const lines = new LineCounter();
    const doc = parseDocument(reader.read(join(dir, name)), { lineCounter: lines });
    const fail = (offset: number, message: string): never => {
      const { line, col } = lines.linePos(offset);
      throw new CompileError(`${name}:${line}:${col}: ${message}`);
    };
    if (doc.errors.length > 0) {
      const error = doc.errors[0];
      return fail(error?.pos[0] ?? 0, error?.message ?? "invalid YAML");
    }
    visit(doc, {
      Node(_key, node) {
        if (isAlias(node)) fail(node.range?.[0] ?? 0, "aliases are not allowed");
        if ("anchor" in node && node.anchor) {
          fail(node.range?.[0] ?? 0, "anchors are not allowed");
        }
      },
    });
    files[name] = doc.toJS() as Json;
  }
  return files;
}

function main(argv: string[]): number {
  const dir = argv[2];
  if (!dir) {
    process.stderr.write("usage: seampact-spike <workspace-dir>\n");
    return 2;
  }
  try {
    const text = `${canonical(compile(fsReader, dir))}\n`;
    const sha = createHash("sha256").update(text).digest("hex");
    process.stdout.write(`${text}sha256:${sha}\n`);
    return 0;
  } catch (error) {
    if (error instanceof CompileError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = main(process.argv);
