export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("bench: the median of no values.");

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  const lower = sorted[middle - 1] ?? upper;

  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
}

// The spread of repeated runs as a share of their median: (highest - lowest) / median.
export function spreadShare(values: readonly number[]): number {
  const centre = median(values);

  return centre === 0 ? 0 : (Math.max(...values) - Math.min(...values)) / centre;
}
