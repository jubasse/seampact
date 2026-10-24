import { expect, test } from "vitest";
import { withModeline } from "./modelines.js";

const MODELINE = "# yaml-language-server: $schema=.seampact/schemas/api.schema.json";
const OLD_MODELINE = "# yaml-language-server: $schema=elsewhere.json";

test("a modeline goes before an LF file, with LF", () => {
  expect(withModeline("api:\n  name: a\n", MODELINE)).toBe(`${MODELINE}\napi:\n  name: a\n`);
});

test("a modeline goes before a CRLF file, with CRLF", () => {
  expect(withModeline("api:\r\n  name: a\r\n", MODELINE)).toBe(
    `${MODELINE}\r\napi:\r\n  name: a\r\n`,
  );
});

test("a modeline replaces the first line only when line endings are mixed", () => {
  const rest = "\napi:\n  name: a\n  version: 1\r\n  kind: product\n";

  expect(withModeline(`${OLD_MODELINE}${rest}`, MODELINE)).toBe(`${MODELINE}${rest}`);
});

test("a modeline takes the first line's own ending when later lines differ", () => {
  expect(withModeline("api:\n  name: a\r\n", MODELINE)).toBe(`${MODELINE}\napi:\n  name: a\r\n`);
});

test("a file holding only a modeline without a newline gets the new one alone", () => {
  expect(withModeline(OLD_MODELINE, MODELINE)).toBe(MODELINE);
});

test("an empty file gets the modeline and a newline", () => {
  expect(withModeline("", MODELINE)).toBe(`${MODELINE}\n`);
});

test("a byte order mark stays first", () => {
  expect(withModeline("﻿api:\n", MODELINE)).toBe(`﻿${MODELINE}\napi:\n`);
  expect(withModeline(`﻿${OLD_MODELINE}\napi:\n`, MODELINE)).toBe(`﻿${MODELINE}\napi:\n`);
});
