// Compares a committed document with a freshly emitted one byte for byte (FR-11), naming the first line that differs.

export interface DocumentDrift {
  /** One-based line number of the first difference. */
  line: number;
  /** The committed line, or absent when the committed document ends before it. */
  committed?: string;
  /** The emitted line, or absent when the emitted document ends before it. */
  emitted?: string;
}

export function findDocumentDrift(committed: string, emitted: string): DocumentDrift | undefined {
  if (committed === emitted) return undefined;

  const committedLines = committed.split("\n");
  const emittedLines = emitted.split("\n");
  const lineCount = Math.max(committedLines.length, emittedLines.length);

  for (let index = 0; index < lineCount; index += 1) {
    const committedLine = committedLines[index];
    const emittedLine = emittedLines[index];

    if (committedLine === emittedLine) continue;

    const drift: DocumentDrift = { line: index + 1 };

    if (committedLine !== undefined) drift.committed = committedLine;

    if (emittedLine !== undefined) drift.emitted = emittedLine;

    return drift;
  }

  // Equal lines with unequal bytes cannot happen once both split on LF; kept so every input has an answer.
  return { line: lineCount };
}
