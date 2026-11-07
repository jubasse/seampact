import type { Origin, SourceMap } from "@seampact/spec/ir";
import type { Diagnostic } from "./diagnostic.js";

type Locations = SourceMap["locations"];

/**
 * ADR 0004 section 11: the side table key is `"<layer>#<pointer>"`, the serialised form of an
 * origin. The table names the api (each api has its own), so `api` is never part of the key: an
 * origin copied from another api is looked up in that api's table.
 */
export function diagnosticLocationKey(origin: Origin): string {
  return `${origin.layer}#${origin.pointer}`;
}

export interface PrintedLocation {
  file: string;
  line: number;
  column: number;
}

const UNKNOWN: PrintedLocation = { file: "(unknown location)", line: 0, column: 0 };

/** `locations` is the table the origin belongs to: an api's, or the workspace's for load diagnostics. */
export function diagnosticLocation(origin: Origin, locations: Locations): PrintedLocation {
  const key = diagnosticLocationKey(origin);

  return Object.hasOwn(locations, key) ? (locations[key] as PrintedLocation) : UNKNOWN;
}

function compare(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** ADR 0006 section 4: sorted by file, line, column, then rule; the message breaks any remaining tie. */
export function diagnosticSort(
  diagnostics: readonly Diagnostic[],
  locations: Locations,
): Diagnostic[] {
  const keyed = diagnostics.map((d) => ({ d, at: diagnosticLocation(d.origin, locations) }));

  keyed.sort(
    (x, y) =>
      compare(x.at.file, y.at.file) ||
      compare(x.at.line, y.at.line) ||
      compare(x.at.column, y.at.column) ||
      compare(x.d.rule, y.d.rule) ||
      compare(x.d.message, y.d.message),
  );

  return keyed.map((k) => k.d);
}

// Every control (Cc: C0, DEL, C1) and format character (Cf: the bidirectional marks,
// embeddings, overrides and isolates, U+061C, the zero-width U+200B to U+200D, U+2060 to U+2064,
// U+FEFF, the tag characters), the line and paragraph separators, and a lone surrogate.
const ACTIVE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;

/**
 * Authored strings and file names reach the terminal through messages: a character a terminal
 * acts on, or one that hides or reorders text (an escape sequence, a bidirectional override, a
 * zero-width joiner), is written as `\uXXXX` instead, `\u{XXXXX}` beyond the basic plane.
 * The printer applies it to every message; a stage applies it to authored text when it builds a
 * message, so a renderer other than this printer receives inert text too.
 */
export function diagnosticInert(text: string): string {
  return text.replace(ACTIVE, (ch) => {
    const code = ch.codePointAt(0) as number;
    const hex = code.toString(16).toUpperCase();

    return code > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, "0")}`;
  });
}

function sentence(text: string): string {
  const t = diagnosticInert(text.replace(/\s+/g, " ").trim());

  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * One line per diagnostic in the form editors read, related locations indented below it. No
 * colour, no absolute path (the table holds workspace-relative files), no character a terminal
 * acts on. Lines are joined with
 * "\n"; the caller ends the output.
 */
export function printDiagnostics(diagnostics: readonly Diagnostic[], locations: Locations): string {
  const lines: string[] = [];

  for (const d of diagnosticSort(diagnostics, locations)) {
    const at = diagnosticLocation(d.origin, locations);

    lines.push(
      `${diagnosticInert(at.file)}:${at.line}:${at.column}: ${d.severity} ${d.rule}: ${sentence(d.message)} Fix: ${sentence(d.fix)}`,
    );
    const related = d.related
      .map((r) => ({ r, at: diagnosticLocation(r.origin, locations) }))
      .sort(
        (x, y) =>
          compare(x.at.file, y.at.file) ||
          compare(x.at.line, y.at.line) ||
          compare(x.at.column, y.at.column) ||
          compare(x.r.message, y.r.message),
      );

    for (const { r, at: rat } of related) {
      lines.push(
        `  ${diagnosticInert(rat.file)}:${rat.line}:${rat.column}: ${sentence(r.message)}`,
      );
    }
  }

  return lines.join("\n");
}
