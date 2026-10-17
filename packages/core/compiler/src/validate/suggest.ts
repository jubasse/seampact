// The known keyword closest to a misspelt one, within a small edit distance.
export function closestKeyword(word: string, known: readonly string[]): string | undefined {
  const limit = Math.max(1, Math.min(3, Math.floor(word.length / 3)));
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const candidate of known) {
    const d = distance(word.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance || (d === bestDistance && best !== undefined && candidate < best)) {
      best = candidate;
      bestDistance = d;
    }
  }
  return bestDistance <= limit ? best : undefined;
}

// Optimal string alignment distance: insertions, deletions, substitutions, adjacent swaps.
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[] = new Array(rows * cols).fill(0);
  const at = (i: number, j: number): number => d[i * cols + j] ?? 0;
  for (let i = 0; i < rows; i++) d[i * cols] = i;
  for (let j = 0; j < cols; j++) d[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, at(i - 2, j - 2) + 1);
      }
      d[i * cols + j] = v;
    }
  }
  return at(a.length, b.length);
}
