const DECIMAL_LITERAL = /^(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/;

// An integer is a multiple of `p / 10^d` exactly when it is a multiple of `p / gcd(p, 10^d)`: the exact integer step
// of a decimal `multipleOf` step, which a validator checks with an integer remainder. Undefined for a literal that is
// not a nonzero decimal.
export function reducedIntegerStep(literal: string): string | undefined {
  const parts = DECIMAL_LITERAL.exec(literal);
  const written = (parts?.[1] ?? "") + (parts?.[2] ?? "");

  if (parts === null || written === "" || BigInt(written) === 0n) return undefined;

  const digits = BigInt(written);
  const scale = (parts[2] ?? "").length - Number(parts[3] ?? "0");

  if (scale <= 0) return String(digits * 10n ** BigInt(-scale));

  return String(digits / greatestCommonDivisor(digits, 10n ** BigInt(scale)));
}

function greatestCommonDivisor(first: bigint, second: bigint): bigint {
  return second === 0n ? first : greatestCommonDivisor(second, first % second);
}
