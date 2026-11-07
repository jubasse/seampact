import type { CliProblem } from "../cli-problem.js";

// The seampact block of an AGENTS.md: the template filled for a project, and its place between two markers, so a
// second install rewrites the block and leaves every other line of the file alone.

export const AGENTS_BLOCK_END_MARKER = "<!-- seampact:end -->";

// A begin marker line, with the version that wrote it, or none.
const BEGIN_MARKER_LINE = /^<!-- seampact:begin(?: ([^\s>]*))? *-->$/;
const FENCE_LINE = /^(`{3,}|~{3,})/;

export interface AgentsBlockValues {
  /** The command line that runs seampact, `npx seampact`. */
  readonly seampact: string;
  /** The folder the skills were copied to, as the block names it. */
  readonly skillsDirectory: string;
}

export function renderAgentsBlock(template: string, values: AgentsBlockValues): string {
  return template
    .replaceAll("{{seampact}}", values.seampact)
    .replaceAll("{{skillsDirectory}}", values.skillsDirectory)
    .trim();
}

function markedBlock(block: string, version: string): string {
  return `<!-- seampact:begin ${version} -->\n${block}\n${AGENTS_BLOCK_END_MARKER}`;
}

export type AgentsFileMerge =
  | { status: "merged"; text: string; previousVersion: string | undefined }
  | { status: "refused"; problem: CliProblem };

/** The AGENTS.md text with the block in place: appended when the file has none, replaced between the markers. */
export function mergeAgentsBlock(
  existing: string | undefined,
  block: string,
  version: string,
): AgentsFileMerge {
  const marked = markedBlock(block, version);

  if (existing === undefined || existing.trim() === "")
    return { status: "merged", text: `${marked}\n`, previousVersion: undefined };

  const lines = existing.split("\n");
  const markers = markerLines(lines);

  if (markers.begins.length === 0 && markers.ends.length === 0)
    return {
      status: "merged",
      text: `${existing.trimEnd()}\n\n${marked}\n`,
      previousVersion: undefined,
    };

  const [begin] = markers.begins;
  const [end] = markers.ends;

  if (markers.begins.length !== 1 || markers.ends.length !== 1)
    return { status: "refused", problem: unbalancedMarkers() };

  if (begin === undefined || end === undefined || end < begin.line)
    return { status: "refused", problem: unbalancedMarkers() };

  const before = lines.slice(0, begin.line).map((line) => `${line}\n`);
  const after = lines.slice(end + 1).map((line) => `\n${line}`);

  return {
    status: "merged",
    text: `${before.join("")}${marked}${after.join("")}`,
    previousVersion: begin.version,
  };
}

interface MarkerLines {
  readonly begins: readonly { readonly line: number; readonly version: string | undefined }[];
  readonly ends: readonly number[];
}

// The lines that hold a marker alone, outside code fences: a user's file may show the markers in an example.
function markerLines(lines: readonly string[]): MarkerLines {
  const begins: { line: number; version: string | undefined }[] = [];
  const ends: number[] = [];
  let openFence: string | undefined;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const fence = FENCE_LINE.exec(trimmed)?.[1];

    if (openFence !== undefined) {
      if (fence !== undefined && isClosingFence(trimmed, openFence)) openFence = undefined;

      continue;
    }

    if (fence !== undefined) {
      openFence = fence;

      continue;
    }

    const begin = BEGIN_MARKER_LINE.exec(trimmed);

    if (begin !== null) begins.push({ line: index, version: begin[1] || undefined });

    if (trimmed === AGENTS_BLOCK_END_MARKER) ends.push(index);
  }

  return { begins, ends };
}

function isClosingFence(trimmed: string, openFence: string): boolean {
  const fenceCharacter = openFence.charAt(0);

  return trimmed.length >= openFence.length && [...trimmed].every((c) => c === fenceCharacter);
}

function unbalancedMarkers(): CliProblem {
  return {
    code: "agents.markers.unbalanced",
    where: "AGENTS.md",
    message: `The file does not hold exactly one '<!-- seampact:begin <version> -->' line followed by one '${AGENTS_BLOCK_END_MARKER}' line, outside code fences.`,
    fix: "Keep one pair of markers, each on its own line, or delete both and the lines between them, then run `agents install` again.",
  };
}
