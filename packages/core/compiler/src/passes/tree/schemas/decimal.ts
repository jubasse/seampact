// Exact decimals for the refinement checks of examples (ADR 0003 section 8): a bound is a decimal literal string and
// a value a JSON number or an int64 or decimal string, compared without rounding.

/** The value `units / 10^scale`. */
export interface TreeSchemasDecimal {
  units: bigint;
  scale: number;
}

const DECIMAL_TEXT = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;
const TEN = 10n;

/** The exact value of a decimal text or of a number's shortest form (`1e-7` included); undefined for other text. */
export function treeSchemasDecimalOf(value: number | string): TreeSchemasDecimal | undefined {
  const match = DECIMAL_TEXT.exec(String(value));

  if (match === null) return undefined;
  const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
  const units = BigInt(`${sign}${whole}${fraction}`);
  const scale = fraction.length - Number(exponent);

  return scale >= 0 ? { units, scale } : { units: units * TEN ** BigInt(-scale), scale: 0 };
}

function aligned(a: TreeSchemasDecimal, b: TreeSchemasDecimal): [bigint, bigint] {
  const scale = Math.max(a.scale, b.scale);

  return [a.units * TEN ** BigInt(scale - a.scale), b.units * TEN ** BigInt(scale - b.scale)];
}

/** Negative when `a` is below `b`, zero when equal, positive when above. */
export function treeSchemasCompareDecimals(a: TreeSchemasDecimal, b: TreeSchemasDecimal): number {
  const [left, right] = aligned(a, b);

  return left === right ? 0 : left < right ? -1 : 1;
}

/** Whether `value` is a whole multiple of a non-zero `step`. */
export function treeSchemasIsMultipleOf(
  value: TreeSchemasDecimal,
  step: TreeSchemasDecimal,
): boolean {
  const [units, stepUnits] = aligned(value, step);

  return stepUnits !== 0n && units % stepUnits === 0n;
}
