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

export type FileKind = "include" | "ref" | "file" | "extends" | "pack" | "workspace";

const WHAT: Record<FileKind, string> = {
  include: "$include",
  ref: "$ref",
  file: "$file",
  extends: "extends",
  pack: "packs",
  workspace: "workspace",
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

export class FileStore {
  private readonly parsed = new Map<string, ParsedFile | null>();
  private readonly texts = new Map<string, string | null>();
  /** Every file the load read or tried to read, for the watch primitive. */
  readonly touched = new Set<string>();

  constructor(
    readonly reader: LoadReader,
    private readonly reporter: Reporter,
  ) {}

  rawText(file: string): string | undefined {
    this.touched.add(file);
    if (!this.texts.has(file)) {
      const text = this.reader.readText(file);
      this.texts.set(file, text === undefined ? null : normalizeText(text));
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
    from: ParsedFile,
    raw: string,
    at: SiteLocation,
    kind: FileKind,
  ): { path: string; fragment: string | undefined } | undefined {
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
    const checked = this.checkFile(r.path, from.boundary, at, what, raw);
    return checked ? r : undefined;
  }

  /** Existence, case and symlink checks for a path already inside its boundary. */
  checkFile(file: string, boundary: string, at: SiteLocation, what: string, raw = file): boolean {
    this.touched.add(file);
    const c = checkCase(this.reader, file);
    if (c.kind === "case") {
      this.reporter.report({
        rule: "path-case",
        message: `path '${raw}' of ${what} differs in case from the file on disk, '${c.actual}'`,
        fix: `write the path as '${c.actual}'; compilation must not depend on the file system's case rules`,
        at,
      });
      return false;
    }
    const real = c.kind === "missing" ? undefined : this.reader.realPath(file);
    if (real === undefined) {
      this.reporter.report({
        rule: "file-missing",
        message: `file '${file}' named by ${what} does not exist`,
        fix: "create the file, or fix the path",
        at,
      });
      return false;
    }
    const realBoundary = boundary === "." ? "." : (this.reader.realPath(boundary) ?? boundary);
    if (!isInside(realBoundary, real)) {
      this.reporter.report({
        rule: "path-escape",
        message: `file '${file}' of ${what} resolves through a symbolic link to '${real}', outside ${boundary === "." ? "the workspace root" : `the package (${boundary})`}`,
        fix: "replace the link with a copy of the file, or move the target inside the workspace",
        at,
      });
      return false;
    }
    return true;
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
    const doc = parseDocument(text, {
      schema: "core",
      lineCounter: lc,
      merge: false,
      uniqueKeys: false,
    });
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
    if (pf.root) this.walk(pf, pf.root, false);
  }

  private walk(pf: ParsedFile, node: Node, isKey: boolean): void {
    const at = nodeSite(pf, node);
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
        if (isNode(pair.key)) this.walk(pf, pair.key, true);
        if (isNode(pair.value)) this.walk(pf, pair.value, false);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) if (isNode(item)) this.walk(pf, item, false);
    }
  }

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
