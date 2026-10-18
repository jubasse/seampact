import type { SignatureTemplate, SignedTemplateRequest } from "@seampact/hooks";
import { describe, expect, test } from "vitest";
import vectors from "../vectors/adr-0013.json" with { type: "json" };
import {
  EmptySignatureSecretError,
  type SignatureFailure,
  UnsupportedSignatureAlgorithmError,
  verifyTemplateSignature,
} from "./verify-template-signature.js";

// Why each 401 vector fails (ADR 0013): a wrong MAC, or a timestamp outside the tolerance.
const FAILURE_OF_VECTOR: Readonly<Record<string, SignatureFailure>> = {
  G3: "signature-mismatch",
  S3: "timestamp-outside-tolerance",
  S4: "timestamp-outside-tolerance",
  S5: "signature-mismatch",
  S8: "signature-mismatch",
};

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
    expect(verification.failure).toBe(FAILURE_OF_VECTOR[vector.id]);
  });

  test.each([[""], [new Uint8Array()]])("an empty secret is refused by name", async (secret) => {
    const vector = vectors.cases[0];
    const request = signedRequest("github", vector?.header ?? "", "Hello, World!");
    const verification = verifyTemplateSignature(request, () => [secret]);

    await expect(verification).rejects.toBeInstanceOf(EmptySignatureSecretError);
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
