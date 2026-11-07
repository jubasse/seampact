import type { CliProblem } from "../cli-problem.js";

// The seampact block of an AGENTS.md: the template filled for a project, and its place between two markers, so a
// second install rewrites the block and leaves every other line of the file alone.

export const AGENTS_BLOCK_END_MARKER = "<!-- seampact:end -->";

const BEGIN_MARKER_PATTERN = /<!-- seampact:begin [^>]*-->/g;

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
  | { status: "merged"; text: string }
  | { status: "refused"; problem: CliProblem };

/** The AGENTS.md text with the block in place: appended when the file has none, replaced between the markers. */
export function mergeAgentsBlock(
  existing: string | undefined,
  block: string,
  version: string,
): AgentsFileMerge {
  const marked = markedBlock(block, version);

  if (existing === undefined || existing.trim() === "")
    return { status: "merged", text: `${marked}\n` };

  const begins = [...existing.matchAll(BEGIN_MARKER_PATTERN)];
  const endIndex = existing.indexOf(AGENTS_BLOCK_END_MARKER);
  const endCount = existing.split(AGENTS_BLOCK_END_MARKER).length - 1;

  if (begins.length === 0 && endCount === 0)
    return { status: "merged", text: `${existing.trimEnd()}\n\n${marked}\n` };

  const begin = begins[0];

  if (begins.length !== 1 || endCount !== 1 || begin === undefined || endIndex < begin.index)
    return { status: "refused", problem: unbalancedMarkers() };

  const afterEnd = endIndex + AGENTS_BLOCK_END_MARKER.length;

  return {
    status: "merged",
    text: `${existing.slice(0, begin.index)}${marked}${existing.slice(afterEnd)}`,
  };
}

function unbalancedMarkers(): CliProblem {
  return {
    code: "agents.markers.unbalanced",
    where: "AGENTS.md",
    message: `The file does not hold exactly one '<!-- seampact:begin <version> -->' followed by one '${AGENTS_BLOCK_END_MARKER}'.`,
    fix: "Keep one pair of markers, or delete both and the lines between them, then run `agents install` again.",
  };
}
