import { breaksText } from "../gate/gate.js";
import type { DeprecationEntry, DiffChange, DiffResult, DiffValue } from "../result.js";
import { apiVersionText } from "../walk/refusals.js";

// The text form of a diff report: one line per change, then the deprecations, then each gate failure in the
// CLI's diagnostic form (`<code>: <message> Fix: <fix>`), then the gate outcome. A refused diff prints its
// refusals in the same diagnostic form.

const NO_OPERATION = "-";

export function formatDiffReport(result: DiffResult): string {
  if (!result.ok) return lines(result.refusals.map(diagnosticLine));

  const header = `${result.api} ${apiVersionText(result.after.version)}: compat.policy ${result.policy.applied} (before ${result.policy.before}, after ${result.policy.after}), gate ${result.settings.gate}`;
  const changeLines = result.changes.length === 0 ? ["no change"] : result.changes.map(changeLine);
  const deprecationLines = result.deprecations.map(deprecationLine);
  const failureLines = result.gate.failures.map(diagnosticLine);
  const outcome = result.gate.passed
    ? "gate passed"
    : `gate failed: ${result.gate.failures.length} failure(s)`;

  return lines([header, ...changeLines, ...deprecationLines, ...failureLines, outcome]);
}

function lines(texts: readonly string[]): string {
  return `${texts.join("\n")}\n`;
}

function changeLine(change: DiffChange): string {
  const label =
    change.classification === "breaking"
      ? `breaking ${breaksText(change.breaks)}`
      : change.classification;
  const operations = change.operations.length > 0 ? change.operations.join(",") : NO_OPERATION;
  const position = change.position === "none" ? "" : ` ${change.position}`;
  const values = valuesText(change.before, change.after);
  const cause = change.cause === undefined ? "" : ` [pack ${change.cause.pack}]`;
  const exemption = change.exemption === undefined ? "" : ` [exempt: ${change.exemption}]`;

  return `${label} ${operations}${position} ${change.pointer}: ${change.kind} ${change.case}${values}${cause}${exemption}`;
}

function valuesText(before: DiffValue | undefined, after: DiffValue | undefined): string {
  if (before !== undefined && after !== undefined)
    return ` (${String(before)} -> ${String(after)})`;

  const value = before ?? after;

  return value === undefined ? "" : ` (${String(value)})`;
}

function deprecationLine(entry: DeprecationEntry): string {
  if (entry.subject !== "operation") {
    const subject =
      entry.property === undefined ? entry.schema : `${entry.schema}.${entry.property}`;

    return `deprecation ${entry.subject} ${subject}: ${entry.status}`;
  }

  const successor = entry.successor === undefined ? "" : `, successor ${entry.successor}`;
  const sunset = entry.pastSunset ? "past sunset" : `${entry.daysToSunset} days to sunset`;

  return `deprecation ${entry.operation}: ${entry.status}, since ${entry.since}, sunset ${entry.sunset} (${sunset})${successor}`;
}

function diagnosticLine(diagnostic: { code: string; message: string; fix: string }): string {
  return `${diagnostic.code}: ${diagnostic.message} Fix: ${diagnostic.fix}`;
}
