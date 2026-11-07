// Code-unit order, never a locale's (ADR 0015 "Generate is pure").
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
