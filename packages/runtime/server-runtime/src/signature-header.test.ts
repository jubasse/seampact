import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseSignatureHeader } from "./signature-header.js";

interface VectorCase {
  readonly id: string;
  readonly scheme: string;
  readonly header: string;
}

interface Vectors {
  readonly schemes: Readonly<Record<string, { readonly format: string }>>;
  readonly cases: readonly VectorCase[];
}

// The ADR 0013 vectors, shared with the signature helper's own test.
const VECTORS: Vectors = JSON.parse(
  readFileSync(new URL("../../signed-webhooks/vectors/adr-0013.json", import.meta.url), "utf8"),
);

const STRIPE_FORMAT = "t={ts},v1={sig}";

function formatOf(scheme: string): string {
  const format = VECTORS.schemes[scheme]?.format;

  if (format === undefined) throw new Error(`the vectors declare no scheme '${scheme}'`);

  return format;
}

function expectedFields(header: string, format: string) {
  const pairs = header
    .split(",")
    .map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]);

  if (format === STRIPE_FORMAT) {
    return {
      timestamp: pairs.find(([name]) => name === "t")?.[1],
      candidateSignatures: pairs.filter(([name]) => name === "v1").map(([, value]) => value),
    };
  }

  return { candidateSignatures: [header.slice(format.indexOf("{sig}"))] };
}

describe("parses the ADR 0013 vector headers", () => {
  for (const vector of VECTORS.cases.filter((candidate) => candidate.id.startsWith("S"))) {
    test(`${vector.id} parses to its timestamp and candidate signatures`, () => {
      const format = formatOf(vector.scheme);

      expect(parseSignatureHeader(format, vector.header)).toEqual(
        expectedFields(vector.header, format),
      );
    });
  }

  test("S10: a missing header answers 401 without calling the hook", () => {
    expect(parseSignatureHeader(STRIPE_FORMAT, undefined)).toBeUndefined();
    expect(parseSignatureHeader(STRIPE_FORMAT, "")).toBeUndefined();
  });

  test("S11: a malformed header answers 401 without calling the hook", () => {
    for (const header of [
      "t=1700000000",
      "v1=abc",
      "t=17000x0000,v1=abc",
      "t=1700000000,t=1700000001,v1=abc",
      "t=1700000000,garbage,v1=abc",
    ]) {
      expect(parseSignatureHeader(STRIPE_FORMAT, header)).toBeUndefined();
    }
  });

  test("a prefixed format reads the signature after its prefix", () => {
    expect(parseSignatureHeader("sha256={sig}", "sha256=abc")).toEqual({
      candidateSignatures: ["abc"],
    });
    expect(parseSignatureHeader("sha256={sig}", "sha1=abc")).toBeUndefined();
  });
});
