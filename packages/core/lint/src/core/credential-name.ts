import { isKnownVariant } from "@seampact/spec/ir";
import { splitName } from "@seampact/spec/naming";
import type { LintRuleDefinition } from "../plugin.js";
import { lintOwnsOrigin } from "./origins.js";

// The last word of a credential name (`accessToken`, `clientSecret`); `tokenType` ends in `type` and is not one.
const CREDENTIAL_WORDS: ReadonlySet<string> = new Set([
  "password",
  "passwd",
  "passphrase",
  "secret",
  "token",
  "credential",
  "credentials",
]);

// The last two words (`apiKey`, `private_key`).
const CREDENTIAL_PAIRS: ReadonlySet<string> = new Set(["api key", "private key"]);

function looksLikeCredential(name: string): boolean {
  const words = splitName(name);
  const last = words.at(-1);

  if (last === undefined) return false;

  return CREDENTIAL_WORDS.has(last) || CREDENTIAL_PAIRS.has(words.slice(-2).join(" "));
}

export const credentialName: LintRuleDefinition = {
  name: "credential-name",
  defaultSeverity: "warning",
  reports: "a property named like a credential and not `sensitive` (ADR 0003 section 6)",
  silencedOn: "the property or schema",
  check({ ir, report }) {
    for (const schema of Object.values(ir.schemas)) {
      if (!isKnownVariant("Schema", schema) || schema.kind !== "object") continue;

      for (const property of schema.properties) {
        if (property.sensitive || !looksLikeCredential(property.name)) continue;

        if (!lintOwnsOrigin(property.origin)) continue;
        report({
          message: `The property '${schema.id}.${property.name}' is named like a credential and is not sensitive.`,
          fix: `Mark '${schema.id}.${property.name}' sensitive, or allow seampact/credential-name on it with a reason.`,
          origin: property.origin,
          allowAt: [property.origin, schema.origin],
        });
      }
    }
  },
};
