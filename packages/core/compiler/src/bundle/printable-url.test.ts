import { expect, test } from "vitest";
import { printableUrl, withPrintableUrl } from "./printable-url.js";

const PRINTED_FORMS: ReadonlyArray<readonly [string, string]> = [
  ["https://user:SECRET@Host.example:8443/a/b?token=S2#frag", "https://host.example:8443/a/b"],
  ["https://host.example", "https://host.example/"],
  ["git@github.com:owner/repo.git", "git@github.com:owner/repo.git"],
  ["/local/path", "/local/path"],
  ["https://u:SECRET@h:99999/x?t=S2", "https://h:99999/x"],
  ["gopher://u:SECRET@h:99999/r", "gopher://h:99999/r"],
  ["https://u:SECRET@[::1/x#f", "https://[::1/x"],
  ["https://h:abc/x?t=S2", "https://h:abc/x"],
  [" \thttps://u:SECRET@h:99999/x", "https://h:99999/x"],
  ["https:/u:SECRET@h:99999/x", "https:/h:99999/x"],
  ["https:\\\\u:SECRET@h:99999/x", "https:\\\\h:99999/x"],
  ["https:u:SECRET@h:99999/x", "https:h:99999/x"],
  ["https://u:SECRET#?x@h:99999/x?t=S2", "https://h:99999/x"],
];

test.each(PRINTED_FORMS)(
  "%s is printed without its credentials, query and fragment",
  (written, printed) => {
    expect(printableUrl(written)).toBe(printed);
  },
);

test("no printed form holds the password or the query value", () => {
  for (const [written] of PRINTED_FORMS) {
    expect(printableUrl(written)).not.toContain("SECRET");
    expect(printableUrl(written)).not.toContain("S2");
  }
});

test("a tool's error text that repeats the URL shows its printable form", () => {
  const url = "https://x-access-token:SECRET@github.com/o/r.git";

  expect(withPrintableUrl(`Command failed: git fetch ${url} v1`, url)).toBe(
    "Command failed: git fetch https://github.com/o/r.git v1",
  );
});
