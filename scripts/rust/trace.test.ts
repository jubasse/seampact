import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkTraces, listTypeScriptFunctions } from "./trace.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway repository holding the given files, keyed by repository-relative path. */
function repositoryWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "trace-"));

  temporaryRoots.push(root);

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  return root;
}

const TYPESCRIPT_SOURCE = [
  "export function load(path: string): string { const inner = () => path; return inner(); }",
  "const resolve = (name: string) => name;",
  "const LIMIT = 3;",
  "export class Reader { read(): number { return LIMIT; } }",
].join("\n");

const RUST_SOURCE =
  "pub fn load(path: &str) -> String { path.to_owned() }\nfn resolve<'a>(name: &'a str) -> &'a str { name }\n";

/** A repository with one TypeScript file, one Rust file and the given trace. */
function repositoryWithTrace(trace: string): string {
  return repositoryWith({
    "packages/core/load.ts": TYPESCRIPT_SOURCE,
    "crates/load/src/lib.rs": RUST_SOURCE,
    "crates/load/trace.tsv": trace,
  });
}

const COMPLETE_TRACE = [
  "src/lib.rs#load\tpackages/core/load.ts#load",
  "src/lib.rs#resolve\tpackages/core/load.ts#resolve",
  "-\tpackages/core/load.ts#Reader.read\tskip: no consumer",
  "",
].join("\n");

describe("listTypeScriptFunctions", () => {
  it("lists top-level functions, function consts and class methods, not closures", () => {
    expect(listTypeScriptFunctions("load.ts", TYPESCRIPT_SOURCE)).toEqual([
      "load",
      "resolve",
      "Reader.read",
    ]);
  });

  it("lists constructors, accessors, properties, private members, wrapped arrows and object methods", () => {
    const source = [
      "export class Sink {",
      "  constructor(private readonly name: string) { this.name = name; }",
      "  get size(): number { return 1; }",
      "  set size(value: number) { void value; }",
      "  handle = (value: number) => value;",
      "  label = 'plain';",
      "  #emitAt(line: number): number { return line; }",
      "}",
      "export const wrapped = ((name: string) => name) satisfies (name: string) => string;",
      "export const cast = (() => 1) as () => number;",
      "export const rules = { check() { return 1; }, run: () => 2, name: 'x' };",
    ].join("\n");

    expect(listTypeScriptFunctions("sink.ts", source)).toEqual([
      "Sink.constructor",
      "Sink.size",
      "Sink.handle",
      "Sink.#emitAt",
      "wrapped",
      "cast",
      "rules.check",
      "rules.run",
    ]);
  });

  it("lists an overloaded function once", () => {
    const source =
      "function pick(a: string): string;\nfunction pick(a: number): number;\nfunction pick(a: unknown) { return a; }";

    expect(listTypeScriptFunctions("pick.ts", source)).toEqual(["pick"]);
  });
});

describe("checkTraces", () => {
  it("accepts a complete trace and a crate with no trace", () => {
    const root = repositoryWithTrace(COMPLETE_TRACE);

    writeFileSync(join(root, "crates/load/README.md"), "");
    mkdirSync(join(root, "crates/js"));

    expect(checkTraces(root)).toEqual([]);
  });

  it("accepts a merged line whose target exists", () => {
    const trace = COMPLETE_TRACE.replace(
      "src/lib.rs#resolve\tpackages/core/load.ts#resolve",
      "-\tpackages/core/load.ts#resolve\tmerged: src/lib.rs#load",
    );

    expect(checkTraces(repositoryWithTrace(trace))).toEqual([]);
  });

  it("fails on a TypeScript function missing from the trace", () => {
    const trace = COMPLETE_TRACE.replace("src/lib.rs#resolve\tpackages/core/load.ts#resolve\n", "");

    expect(checkTraces(repositoryWithTrace(trace))).toEqual([
      "crates/load/trace.tsv: `packages/core/load.ts#resolve` has no line",
    ]);
  });

  it("fails on a line naming no function of the TypeScript file", () => {
    const trace = `${COMPLETE_TRACE}-\tpackages/core/load.ts#inner\tskip: closure\n`;

    expect(checkTraces(repositoryWithTrace(trace))).toEqual([
      "crates/load/trace.tsv:4: `packages/core/load.ts` has no function `inner`",
    ]);
  });

  it("fails on a TypeScript file that does not exist", () => {
    const trace = `${COMPLETE_TRACE}-\tpackages/core/gone.ts#gone\tskip: removed\n`;

    expect(checkTraces(repositoryWithTrace(trace))).toEqual([
      "crates/load/trace.tsv: TypeScript file `packages/core/gone.ts` does not exist",
    ]);
  });

  it("fails on a Rust file or function that does not exist", () => {
    const trace = COMPLETE_TRACE.replace("src/lib.rs#load", "src/reader.rs#load").replace(
      "src/lib.rs#resolve",
      "src/lib.rs#resolve_name",
    );

    expect(checkTraces(repositoryWithTrace(trace))).toEqual([
      "crates/load/trace.tsv:1: Rust file `crates/load/src/reader.rs` does not exist",
      "crates/load/trace.tsv:2: Rust function `resolve_name` is not declared in `crates/load/src/lib.rs`",
    ]);
  });

  it("fails on a merged line whose target does not exist", () => {
    const trace = COMPLETE_TRACE.replace("skip: no consumer", "merged: src/lib.rs#read");

    expect(checkTraces(repositoryWithTrace(trace))).toEqual([
      "crates/load/trace.tsv:3: Rust function `read` is not declared in `crates/load/src/lib.rs`",
    ]);
  });

  it("fails on a malformed line", () => {
    const trace = COMPLETE_TRACE.replace(
      "src/lib.rs#resolve\tpackages/core/load.ts#resolve",
      "src/lib.rs#resolve packages/core/load.ts#resolve",
    );

    expect(checkTraces(repositoryWithTrace(trace))).toEqual([
      "crates/load/trace.tsv:2: malformed line: expected `<rust path>\\t<ts file>#<function>`",
      "crates/load/trace.tsv: `packages/core/load.ts#resolve` has no line",
    ]);
  });

  it("fails on a `-` line without a skip or merged reason", () => {
    const missingReason = COMPLETE_TRACE.replace("\tskip: no consumer", "");
    const wrongReason = COMPLETE_TRACE.replace("skip: no consumer", "later");

    expect(checkTraces(repositoryWithTrace(missingReason))).toContain(
      "crates/load/trace.tsv:3: malformed line: a `-` line needs a third column, `skip: <reason>`, `merged: <rust path>` or `pending: brief <k>`",
    );
    expect(checkTraces(repositoryWithTrace(wrongReason))).toContain(
      "crates/load/trace.tsv:3: malformed line: the third column is `skip: <reason>`, `merged: <rust path>` or `pending: brief <k>`",
    );
  });

  it("accepts `pending:` lines, a stub or `-`, while the crate keeps its not-ported module", () => {
    const trace = COMPLETE_TRACE.replace(
      "src/lib.rs#resolve\tpackages/core/load.ts#resolve",
      "src/lib.rs#resolve\tpackages/core/load.ts#resolve\tpending: brief 2",
    ).replace("skip: no consumer", "pending: brief 3");
    const root = repositoryWithTrace(trace);

    writeFileSync(join(root, "crates/load/src/not_ported.rs"), "");

    expect(checkTraces(root)).toEqual([]);
  });

  it("fails on a `pending:` line once the not-ported module is gone", () => {
    const trace = COMPLETE_TRACE.replace("skip: no consumer", "pending: brief 3");

    expect(checkTraces(repositoryWithTrace(trace))).toEqual([
      "crates/load/trace.tsv:3: `pending: brief 3` but `crates/load/src/not_ported.rs` is gone: port the function or give a `skip:` reason",
    ]);
  });

  it("fails on a ported line whose third column is not `pending:`", () => {
    const trace = COMPLETE_TRACE.replace(
      "packages/core/load.ts#load",
      "packages/core/load.ts#load\tskip: no consumer",
    );

    expect(checkTraces(repositoryWithTrace(trace))).toContain(
      "crates/load/trace.tsv:1: malformed line: the third column of a ported line is only `pending: brief <k>`",
    );
  });

  it("fails on a file of the crate's tool table with no line, once the trace has one", () => {
    const table = "brief\tfunction\tfile\n1\tload\tload.ts\n2\topen\topen.ts\n";
    const root = repositoryWithTrace(COMPLETE_TRACE);

    writeFileSync(join(root, "packages/core/open.ts"), "export function open() {}");
    mkdirSync(join(root, "docs/maintainers/rust-design/cli-and-tools"), { recursive: true });
    writeFileSync(join(root, "docs/maintainers/rust-design/cli-and-tools/load.tsv"), table);
    mkdirSync(join(root, "crates/fresh"));
    writeFileSync(join(root, "crates/fresh/trace.tsv"), "");
    writeFileSync(join(root, "docs/maintainers/rust-design/cli-and-tools/fresh.tsv"), table);

    expect(checkTraces(root)).toEqual([
      "crates/load/trace.tsv: `packages/core/open.ts` is in `docs/maintainers/rust-design/cli-and-tools/load.tsv` but has no line",
    ]);
  });

  it("reads the generator layer's table of the crate too", () => {
    const root = repositoryWithTrace(COMPLETE_TRACE);
    const table = "brief\tfunction\tfile\n1\topen\topen.ts\n";

    mkdirSync(join(root, "docs/maintainers/rust-design/generators"), { recursive: true });
    writeFileSync(join(root, "docs/maintainers/rust-design/generators/load.tsv"), table);

    expect(checkTraces(root)).toEqual([
      "crates/load/trace.tsv: `packages/core/open.ts` is in `docs/maintainers/rust-design/generators/load.tsv` but has no line",
    ]);
  });

  it("fails on a function traced twice", () => {
    const trace = `${COMPLETE_TRACE}src/lib.rs#load\tpackages/core/load.ts#load\n`;

    expect(checkTraces(repositoryWithTrace(trace))).toEqual([
      "crates/load/trace.tsv:4: `packages/core/load.ts#load` is traced twice",
    ]);
  });

  it("accepts a private member, whose reference holds two `#`", () => {
    const root = repositoryWith({
      "packages/sink.ts": "export class Sink { #emitAt(line: number): number { return line; } }",
      "crates/diff/src/lib.rs": "fn emit_at(line: u32) -> u32 { line }\n",
      "crates/diff/trace.tsv": "src/lib.rs#emit_at\tpackages/sink.ts#Sink.#emitAt\n",
    });

    expect(checkTraces(root)).toEqual([]);
  });

  it("fails on a Rust function named only in a comment", () => {
    const root = repositoryWith({
      "packages/a.ts": "export function emitAt() {}",
      "crates/diff/src/lib.rs": "// fn emit_at(line: u32)\n",
      "crates/diff/trace.tsv": "src/lib.rs#emit_at\tpackages/a.ts#emitAt\n",
    });

    expect(checkTraces(root)).toEqual([
      "crates/diff/trace.tsv:1: Rust function `emit_at` is not declared in `crates/diff/src/lib.rs`",
    ]);
  });

  it("checks the trace of xtask", () => {
    const root = repositoryWith({
      "scripts/a.ts": "export function gate() {}",
      "xtask/src/gate.rs": "pub fn run_gate() {}\n",
      "xtask/trace.tsv":
        "src/gate.rs#run_gate\tscripts/a.ts#gate\n-\tscripts/a.ts#other\tskip: x\n",
    });

    expect(checkTraces(root)).toEqual([
      "xtask/trace.tsv:2: `scripts/a.ts` has no function `other`",
    ]);
  });
});
