import { expect, test } from "vitest";
import { looksLikeCredential } from "./credential-name.js";

// The word list of the rule: a name is a credential by its last word or its last two words, in any case style.

test.each([
  ["password", true],
  ["accessToken", true],
  ["clientSecret", true],
  ["apiKey", true],
  ["private_key", true],
  ["passphrase", true],
  ["tokenType", false],
  ["passwordChangedAt", false],
  ["keyId", false],
])("%s is a credential name: %s", (name, expected) => {
  expect(looksLikeCredential(name)).toBe(expected);
});
