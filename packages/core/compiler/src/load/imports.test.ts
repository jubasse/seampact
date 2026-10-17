import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

// Requirement 11, ADR 0010: the loader reads files through the reader and uses no Node API
// beyond fs, path and crypto, so the Bun fallback stays open.
test("the loader imports no Node module but node:fs, node:path and node:crypto", () => {
  const sources = readdirSync(here).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "golden.ts",
  );
  expect(sources.length).toBeGreaterThan(5);
  const allowed = new Set(["node:fs", "node:path", "node:crypto"]);
  for (const file of sources) {
    const text = readFileSync(join(here, file), "utf8");
    const specs = [
      ...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g),
      ...text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1] as string);
    for (const spec of specs) {
      const isNode =
        spec.startsWith("node:") ||
        ["fs", "path", "crypto", "os", "url", "child_process"].includes(spec);
      if (isNode) expect(allowed.has(spec), `${file} imports ${spec}`).toBe(true);
    }
    expect(text, `${file} must not use require.resolve or import.meta.resolve`).not.toMatch(
      /require\.resolve|import\.meta\.resolve/,
    );
  }
});
