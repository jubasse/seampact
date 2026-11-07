// Checks the lines an app logged while one step ran against the step's log lines expectation.
import type { LogLinesExpectation } from "./suite-case.js";

/** Every mismatch as a sentence: a `contains` text no line holds, or an `excludes` text some line holds. */
export function checkLogLines(
  expectation: LogLinesExpectation,
  lines: readonly string[],
): string[] {
  const failures: string[] = [];

  for (const text of expectation.contains ?? []) {
    if (!lines.some((line) => line.includes(text))) {
      failures.push(`no log line holds ${JSON.stringify(text)}; lines: ${JSON.stringify(lines)}`);
    }
  }

  for (const text of expectation.excludes ?? []) {
    const leaking = lines.filter((line) => line.includes(text));

    if (leaking.length > 0) {
      failures.push(`a log line holds ${JSON.stringify(text)}: ${JSON.stringify(leaking)}`);
    }
  }

  return failures;
}
