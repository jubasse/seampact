import {
  type Document,
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  type Node,
  parseDocument,
  Scalar,
} from "yaml";
import { LOAD_MAX_DEPTH, LOAD_MAX_FILE_BYTES } from "./limits.js";
import { checkCase, isInside, resolveAuthoredPath } from "./paths.js";
import type { LoadReader } from "./reader.js";
import { loadScalarPitfall } from "./scalars.js";
import type { Reporter, SiteLocation } from "./report.js";

export interface ParsedFile {
  path: string;
  boundary: string;
  lc: LineCounter;
  doc: Document.Parsed;
  /** Null when the file failed to parse or holds no node. */
  root: Node | null;
}

export type FileKind = "include" | "ref" | "file" | "extends" | "pack" | "workspace" | "manifest";

const WHAT: Record<FileKind, string> = {
  include: "$include",
  ref: "$ref",
  file: "$file",
  extends: "extends",
  pack: "packs",
  workspace: "workspace",
  manifest: "seampact.pack",
};

export function siteOf(file: string, lc: LineCounter, start: number, end: number): SiteLocation {
  const a = lc.linePos(start);
  const b = lc.linePos(Math.max(start, end));
  return { file, line: a.line, column: a.col, endLine: b.line, endColumn: b.col };
}

export function nodeSite(file: ParsedFile, node: Node | null | undefined): SiteLocation {
  const range = node?.range;
  if (!range) return siteOf(file.path, file.lc, 0, 0);
  return siteOf(file.path, file.lc, range[0], range[1]);
}

/** A pair: from the key's start to the value's end. */
export function pairSite(file: ParsedFile, key: Node | null, value: Node | null): SiteLocation {
  const start = key?.range?.[0] ?? value?.range?.[0] ?? 0;
  const end = value?.range?.[1] ?? key?.range?.[1] ?? start;
  return siteOf(file.path, file.lc, start, end);
}

export const BOM = "﻿";

/** Determinism (ADR 0002 byte-identity): LF line endings, no byte order mark. */
export function normalizeText(text: string): string {
  const noBom = text.startsWith(BOM) ? text.slice(1) : text;
  return noBom.replace(/\r\n?/g, "\n");
}

/** Where a path is written from: the containing file and the boundary it must stay inside. */
export type PathContext = Pick<ParsedFile, "path" | "boundary">;

export interface ResolvedFile {
  path: string;
  /** The checked real path (root-relative), the file's identity: cycles and reads use it. */
  real: string;
  fragment: string | undefined;
}

/**
 * Listings and real paths are asked once per load: a directory named by many targets is listed
 * once, however many distinct paths resolve through it. One load sees one state of the disk.
 */
function memoReader(reader: LoadReader): LoadReader {
  const lists = new Map<string, string[] | undefined>();
  const reals = new Map<string, string | undefined>();
  return {
    ascent: reader.ascent,
    readText: (file, maxBytes) => reader.readText(file, maxBytes),
    listDir(dir) {
      if (!lists.has(dir)) lists.set(dir, reader.listDir(dir));
      return lists.get(dir);
    },
    realPath(file) {
      if (!reals.has(file)) reals.set(file, reader.realPath(file));
      return reals.get(file);
    },
  };
}

export class FileStore {
  private readonly parsed = new Map<string, ParsedFile | null>();
  private readonly texts = new Map<string, string | null>();
  /** Lexical path to the real path `checkFile` accepted for it. */
  private readonly reals = new Map<string, string>();

  /** The checked real path of a file, its identity for cycle detection. */
  realOf(file: string): string {
    return this.reals.get(file) ?? file;
  }
  /** Every file the load read or tried to read, for the watch primitive. */
  readonly touched = new Set<string>();

  readonly reader: LoadReader;

  constructor(
    reader: LoadReader,
    private readonly reporter: Reporter,
  ) {
    this.reader = memoReader(reader);
  }

  /** Reads the real path `checkFile` accepted, not the lexical one (narrows a swap in between). */
  rawText(file: string): string | undefined {
    this.touched.add(file);
    if (!this.texts.has(file)) {
      const got = this.reader.readText(this.reals.get(file) ?? file, LOAD_MAX_FILE_BYTES);
      if (got && "tooLarge" in got) {
        this.reporter.report({
          rule: "file-too-large",
          message: `file '${file}' is larger than ${LOAD_MAX_FILE_BYTES} bytes, the most one contract file may hold`,
          fix: "split the file, with $include, or shrink it",
          at: { file, line: 1, column: 1, endLine: 1, endColumn: 1 },
        });
      }
      this.texts.set(file, got && "text" in got ? normalizeText(got.text) : null);
    }
    return this.texts.get(file) ?? undefined;
  }

  /**
   * Resolves a path written in a contract file and checks every ADR 0002 section 1 rule:
   * no absolute path, no backslash, inside the boundary (also after symlinks), case matching
   * the disk, existing. Reports and returns undefined on failure; nothing outside the boundary
   * is read.
   */
  resolve(
    from: PathContext,
    raw: string,
    at: SiteLocation,
    kind: FileKind,
  ): ResolvedFile | undefined {
    // A path that resolved once resolves the same way: the checks list directories, and a file
    // included from many sites would repeat them.
    const cacheKey = `${from.boundary}\0${from.path}\0${raw}`;
    const hit = this.resolved.get(cacheKey);
    if (hit) return hit;
    const what = WHAT[kind];
    const r = resolveAuthoredPath(from.path, raw, from.boundary);
    if (typeof r === "string") {
      const problems = {
        empty: [`${what} names no file`, "write a path such as ./file.yaml"],
        backslash: [
          `path '${raw}' of ${what} uses a backslash`,
          "write the path with forward slashes",
        ],
        absolute: [
          `path '${raw}' of ${what} is absolute`,
          "write a path relative to this file, starting with ./ or ../",
        ],
        escape: [
          `path '${raw}' of ${what} leaves ${from.boundary === "." ? "the workspace root" : `the pack's package (${from.boundary})`}`,
          "move the file inside the workspace, or add a workspace.yaml at or above every file the contract reads",
        ],
      } as const;
      const [message, fix] = problems[r];
      this.reporter.report({ rule: `path-${r}`, message, fix, at });
      return undefined;
    }
    const real = this.checkFile(r.path, from.boundary, at, what, raw);
    if (typeof real !== "string") return undefined;
    const ok = { ...r, real };
    this.resolved.set(cacheKey, ok);
    return ok;
  }

  private readonly resolved = new Map<string, ResolvedFile>();

  /**
   * Existence, case and symlink checks for a path already inside its boundary (lexically).
   * Containment comes first: every directory is checked inside the boundary, after links, before
   * it is listed, and the file's real path after. Returns the real path, or undefined after
   * reporting. An escape never names the outside target. With `probe`, a missing file is not an
   * error: it returns null without a report (the `node_modules` walk goes on upward).
   */
  checkFile(
    file: string,
    boundary: string,
    at: SiteLocation,
    what: string,
    raw = file,
    probe = false,
  ): string | undefined | null {
    const where = boundary === "." ? "the workspace root" : `the package (${boundary})`;
    const realBoundary = boundary === "." ? "." : this.reader.realPath(boundary);
    const missing = () => {
      this.touched.add(file);
      if (probe) return null;
      this.reporter.report({
        rule: "file-missing",
        message: `file '${file}' named by ${what} does not exist`,
        fix: "create the file, or fix the path",
        at,
      });
      return undefined;
    };
    const escaped = () => {
      this.reporter.report({
        rule: "path-escape",
        message: `file '${file}' of ${what} resolves through a symbolic link to a place outside ${where}`,
        fix: "replace the link with a copy of the file, or move the target inside the workspace",
        at,
      });
      return undefined;
    };
    if (realBoundary === undefined) return missing();
    const inside = (p: string) => {
      const real = this.reader.realPath(p);
      return real === undefined || isInside(realBoundary, real);
    };
    const c = checkCase(this.reader, file, boundary, inside);
    if (c.kind === "escape") return escaped();
    if (c.kind === "missing") return missing();
    if (c.kind === "case") {
      this.touched.add(file);
      this.reporter.report({
        rule: "path-case",
        message: `path '${raw}' of ${what} differs in case from the file on disk, '${c.actual}'`,
        fix: `write the path as '${c.actual}'; compilation must not depend on the file system's case rules`,
        at,
      });
      return undefined;
    }
    const real = this.reader.realPath(file);
    if (real === undefined) return missing();
    if (!isInside(realBoundary, real)) return escaped();
    this.touched.add(file);
    this.reals.set(file, real);
    return real;
  }

  /** Parses a file once; pitfalls P1 to P5 and P9 and syntax errors are reported on first parse. */
  parse(file: string, boundary: string): ParsedFile | undefined {
    const key = `${boundary}|${file}`;
    if (this.parsed.has(key)) return this.parsed.get(key) ?? undefined;
    const text = this.rawText(file);
    if (text === undefined) {
      this.parsed.set(key, null);
      return undefined;
    }
    const lc = new LineCounter();
    let doc: Document.Parsed;
    try {
      doc = parseDocument(text, {
        schema: "core",
        lineCounter: lc,
        merge: false,
        uniqueKeys: false,
      });
    } catch (e) {
      // `yaml` reports its own stack exhaustion as an error; this is the backstop for any other.
      if (!(e instanceof RangeError)) throw e;
      this.reporter.report({
        rule: "yaml-syntax",
        message: "YAML syntax error: the file nests too deeply to be parsed",
        fix: "flatten the nesting, or split the file with $include",
        at: { file, line: 1, column: 1, endLine: 1, endColumn: 1 },
      });
      this.parsed.set(key, null);
      return undefined;
    }
    const pf: ParsedFile = { path: file, boundary, lc, doc, root: doc.contents };
    this.parsed.set(key, pf);
    this.checkDocument(pf);
    return pf;
  }

  private checkDocument(pf: ParsedFile): void {
    const { doc, lc, path } = pf;
    for (const err of doc.errors) {
      const pos = err.pos ?? [0, 0];
      const site = siteOf(path, lc, pos[0], pos[1]);
      if (err.code === "MULTIPLE_DOCS") {
        this.reporter.report({
          rule: "yaml-document",
          message: "the file holds more than one YAML document",
          fix: "one document per file; remove the extra '---'",
          at: site,
        });
      } else {
        this.reporter.report({
          rule: "yaml-syntax",
          message: `YAML syntax error: ${err.message.split("\n")[0]?.replace(/ at line \d+, column \d+:?$/, "")}`,
          fix: "fix the YAML syntax at this position",
          at: site,
        });
      }
    }
    if (doc.errors.some((e) => e.code !== "MULTIPLE_DOCS")) pf.root = null;
    if (pf.root) this.walk(pf, pf.root, false, 0);
  }

  private walk(pf: ParsedFile, node: Node, isKey: boolean, depth: number): void {
    const at = nodeSite(pf, node);
    if (depth > LOAD_MAX_DEPTH) {
      this.reportTooDeep(at);
      return;
    }
    if (isAlias(node)) {
      this.reporter.report({
        rule: "yaml-anchor",
        message: `alias '*${node.source}' is not allowed (P5)`,
        fix: "use $ref to share a declaration, or extends to share a base",
        at,
      });
      return;
    }
    if ((isScalar(node) || isMap(node) || isSeq(node)) && node.anchor !== undefined) {
      this.reporter.report({
        rule: "yaml-anchor",
        message: `anchor '&${node.anchor}' is not allowed (P5)`,
        fix: "use $ref to share a declaration, or extends to share a base",
        at,
      });
    }
    if ((isScalar(node) || isMap(node) || isSeq(node)) && node.tag !== undefined) {
      this.reporter.report({
        rule: "yaml-tag",
        message: `tag '${node.tag.replace("tag:yaml.org,2002:", "!!")}' is not allowed (P9)`,
        fix: "remove the tag; no tags are read, quote the value if it is a string",
        at,
      });
    } else if (isScalar(node) && node.type === Scalar.PLAIN) {
      this.checkPlain(node, isKey, at);
    }
    if (isMap(node)) {
      for (const pair of node.items) {
        if (isNode(pair.key)) this.walk(pf, pair.key, true, depth + 1);
        if (isNode(pair.value)) this.walk(pf, pair.value, false, depth + 1);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) if (isNode(item)) this.walk(pf, item, false, depth + 1);
    }
  }

  /** One report per file: every node below the limit would otherwise repeat it. */
  reportTooDeep(at: SiteLocation): void {
    if (this.tooDeep.has(at.file)) return;
    this.tooDeep.add(at.file);
    this.reporter.report({
      rule: "too-deep",
      message: `the contract nests deeper than ${LOAD_MAX_DEPTH} levels here, counted through $include and $file`,
      fix: "flatten the nesting; a contract never needs this depth",
      at,
    });
  }

  private readonly tooDeep = new Set<string>();

  private checkPlain(node: Scalar, isKey: boolean, at: SiteLocation): void {
    const source = node.source ?? "";
    if (source === "") return;
    if (isKey && source === "<<") {
      this.reporter.report({
        rule: "yaml-anchor",
        message: "merge key '<<' is not allowed (P5)",
        fix: "use $ref to share a declaration, or extends to share a base",
        at,
      });
      return;
    }
    const pitfall = loadScalarPitfall(source, node.value);
    if (pitfall === undefined) return;
    const shown = source.length > 40 ? `${source.slice(0, 37)}...` : source;
    switch (pitfall) {
      case "P1":
        this.reporter.report({
          rule: "yaml-boolean",
          message: `plain '${shown}' is read as a boolean by YAML 1.1 parsers, or is a boolean not in lowercase (P1)`,
          fix: `quote it ('${shown}'), or write true or false`,
          at,
        });
        break;
      case "P2":
        this.reporter.report({
          rule: "yaml-number-format",
          message: `plain number '${shown}' is not written in plain decimal (P2)`,
          fix: "quote it, or write the number in plain decimal",
          at,
        });
        break;
      case "P3":
        this.reporter.report({
          rule: "yaml-ambiguous-scalar",
          message: `plain '${shown}' is a number or a timestamp for YAML 1.1 and a string for YAML 1.2 (P3)`,
          fix: `quote it ('${shown}')`,
          at,
        });
        break;
      case "P4":
        this.reporter.report({
          rule: "yaml-reserved-scalar",
          message: `plain '${shown}' is a YAML 1.1 value or merge key (P4)`,
          fix: `quote it ('${shown}')`,
          at,
        });
        break;
    }
  }
}
