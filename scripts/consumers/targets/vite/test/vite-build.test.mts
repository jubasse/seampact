// The consumer app builds for production with Vite: the generated queries and hooks or composables, the
// copied front runtime and the client bundle for the browser (React's `"use client"` directive included).
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = mkdtempSync(join(tmpdir(), "seampact-vite-build-"));

afterAll(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

test("the app builds with vite", async () => {
  await build({ root: ROOT, configFile: false, logLevel: "warn", build: { outDir: OUT_DIR } });

  expect(readdirSync(join(OUT_DIR, "assets")).some((file) => file.endsWith(".js"))).toBe(true);
});
