// Decimal literal strings of the IR (`-?(0|[1-9][0-9]*)(\.[0-9]+)?`), compared exactly as scaled integers.

interface ScaledDecimal {
  units: bigint;
  scale: number;
}

function parseDecimal(literal: string): ScaledDecimal {
  const negative = literal.startsWith("-");
  const digits = negative ? literal.slice(1) : literal;
  const [whole = "0", fraction = ""] = digits.split(".");
  const units = BigInt(`${whole}${fraction}`);

  return { units: negative ? -units : units, scale: fraction.length };
}

function atScale(decimal: ScaledDecimal, scale: number): bigint {
  return decimal.units * 10n ** BigInt(scale - decimal.scale);
}

/** Negative, zero or positive as `left` is below, equal to or above `right`. */
export function compareDecimals(left: string, right: string): number {
  const leftDecimal = parseDecimal(left);
  const rightDecimal = parseDecimal(right);
  const scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const difference = atScale(leftDecimal, scale) - atScale(rightDecimal, scale);

  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** True when `multiple` is an integer multiple of `divisor` (both non-zero, as `multipleOf` is). */
export function isDecimalMultiple(multiple: string, divisor: string): boolean {
  const multipleDecimal = parseDecimal(multiple);
  const divisorDecimal = parseDecimal(divisor);
  const scale = Math.max(multipleDecimal.scale, divisorDecimal.scale);
  const divisorUnits = atScale(divisorDecimal, scale);

  return divisorUnits !== 0n && atScale(multipleDecimal, scale) % divisorUnits === 0n;
}
