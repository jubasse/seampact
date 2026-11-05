import { expect, test } from "vitest";
import { printableUrl } from "./printable-url.js";

test.each([
  ["https://user:SECRET@Host.example:8443/a/b?token=S2#frag", "https://host.example:8443/a/b"],
  ["https://host.example", "https://host.example/"],
  ["git@github.com:owner/repo.git", "git@github.com:owner/repo.git"],
  ["/local/path", "/local/path"],
  ["https://u:SECRET@h:99999/x?t=S2", "https://h:99999/x"],
  ["gopher://u:SECRET@h:99999/r", "gopher://h:99999/r"],
  ["https://u:SECRET@[::1/x#f", "https://[::1/x"],
  ["https://h:abc/x?t=S2", "https://h:abc/x"],
])("%s is printed without its credentials, query and fragment", (written, printed) => {
  expect(printableUrl(written)).toBe(printed);
});
