// ADR 0002 section 3: the loader's expressions for P1 to P4, verbatim, applied to every plain
// scalar, key or value. An exhaustive list, not examples.

export type LoadScalarPitfall = "P1" | "P2" | "P3" | "P4";

const P1 = /^(y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|True|TRUE|False|FALSE)$/;
const P2_PLAIN_DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const P3_NUMBER =
  /^[-+]?(0b[01_]+|0[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*(:[0-5]?[0-9])+(\.[0-9_]*)?|[0-9][0-9_]*_[0-9_]*|([0-9][0-9_]*)?\.[0-9_]*_[0-9_]*)$/;
const P3_TIMESTAMP = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}([Tt ]|$)/;
const P4 = /^(=|<<)$/;

/**
 * `source` is the scalar as written; `resolved` is what the YAML 1.2 core schema made of it.
 * P2 applies to a scalar the core schema reads as a number, so `resolved` decides it.
 */
export function loadScalarPitfall(
  source: string,
  resolved: unknown,
): LoadScalarPitfall | undefined {
  if (P1.test(source)) return "P1";
  if (P4.test(source)) return "P4";
  if (typeof resolved === "number") return P2_PLAIN_DECIMAL.test(source) ? undefined : "P2";
  if (P3_NUMBER.test(source) || P3_TIMESTAMP.test(source)) return "P3";
  return undefined;
}
