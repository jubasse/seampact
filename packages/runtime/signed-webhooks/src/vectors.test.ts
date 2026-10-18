import type { SignatureTemplate, SignedTemplateRequest } from "@seampact/hooks";
import { describe, expect, test } from "vitest";
import vectors from "../vectors/adr-0013.json" with { type: "json" };
import {
  UnsupportedSignatureAlgorithmError,
  verifyTemplateSignature,
} from "./verify-template-signature.js";

type SchemeName = keyof typeof vectors.schemes;

const KEY_ID = "test";
const MILLISECONDS_PER_SECOND = 1000;
const PAIR_FORMAT = /^(?:[A-Za-z0-9]+=\{(?:ts|sig)\},?)+$/;

// The header parsing the generated boundary does (ADR 0013 "Header parsing is fixed by the format"), enough for
// the two formats of the vectors.
function parseSignatureHeader(
  format: string,
  header: string,
): Pick<SignedTemplateRequest, "timestamp" | "candidateSignatures"> {
  if (!PAIR_FORMAT.test(format)) {
    const prefix = format.replace("{sig}", "");

    return { candidateSignatures: header.startsWith(prefix) ? [header.slice(prefix.length)] : [] };
  }

  const nameOf = new Map(
    format.split(",").map((item) => {
      const [name = "", placeholder = ""] = item.split("=");

      return [name, placeholder];
    }),
  );
  const pairs = header.split(",").map((pair) => {
    const separator = pair.indexOf("=");

    return { placeholder: nameOf.get(pair.slice(0, separator)), value: pair.slice(separator + 1) };
  });
  const timestamp = pairs.find((pair) => pair.placeholder === "{ts}")?.value;
  const candidateSignatures = pairs
    .filter((pair) => pair.placeholder === "{sig}")
    .map((pair) => pair.value);

  return { candidateSignatures, ...(timestamp === undefined ? {} : { timestamp }) };
}

function signedRequest(scheme: SchemeName, header: string, body: string): SignedTemplateRequest {
  const { format, encoding, ...rest } = vectors.schemes[scheme];
  const template: SignatureTemplate = {
    ...rest,
    encoding: encoding === "base64" ? "base64" : "hex",
  };

  return {
    verify: "template",
    rawBody: new TextEncoder().encode(body),
    keyId: KEY_ID,
    template,
    ...parseSignatureHeader(format, header),
  };
}

describe("verifies the ADR 0013 vectors", () => {
  test.each(vectors.cases)("$id answers $expected", async (vector) => {
    const request = signedRequest(vector.scheme as SchemeName, vector.header, vector.body);
    const nowSeconds = "nowSeconds" in vector ? vector.nowSeconds : 0;
    const verification = await verifyTemplateSignature(
      request,
      (keyId) => (keyId === KEY_ID ? vector.secrets : []),
      { now: () => nowSeconds * MILLISECONDS_PER_SECOND },
    );

    expect(verification.verified ? "pass" : "401").toBe(vector.expected);
  });

  test("an algorithm other than hmac-sha256 is refused by name", async () => {
    const request = signedRequest("github", vectors.cases[0]?.header ?? "", "");
    const verification = verifyTemplateSignature(
      { ...request, template: { ...request.template, algorithm: "hmac-sha512" } },
      () => ["secret"],
    );

    await expect(verification).rejects.toBeInstanceOf(UnsupportedSignatureAlgorithmError);
  });
});
