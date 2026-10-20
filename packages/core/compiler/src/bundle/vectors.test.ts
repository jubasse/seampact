import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalBundleFileList } from "@seampact/spec/bundle";
import { expect, test } from "vitest";
import { temporaryDirectory } from "./bundle.test-support.js";
import { bundleIntegrity, bundleSha256Hex } from "./integrity.js";
import { readBundleTarball } from "./tarball-read.js";
import { type BundleVectors, bundleVectors, VECTORS_FILE } from "./vectors.test-support.js";
import { verifyBundle } from "./verify.js";

const WRITE = process.env.SEAMPACT_WRITE_BUNDLE_VECTORS === "1";

function committed(): BundleVectors {
  return JSON.parse(readFileSync(VECTORS_FILE, "utf8"));
}

test("vectors are current", () => {
  const generated = bundleVectors();

  if (WRITE) writeFileSync(VECTORS_FILE, `${JSON.stringify(generated, null, 2)}\n`);

  expect(committed(), "rerun with SEAMPACT_WRITE_BUNDLE_VECTORS=1, then pnpm format").toEqual(
    generated,
  );
});

test("bundle vectors verify as expected", () => {
  for (const vector of committed().directories) {
    const directory = temporaryDirectory();

    for (const file of vector.files) {
      mkdirSync(dirname(join(directory, file.path)), { recursive: true });
      writeFileSync(join(directory, file.path), Buffer.from(file.base64, "base64"));
    }

    const verified = verifyBundle(directory, vector.pin ?? undefined, { channel: vector.channel });
    const failures = verified.ok
      ? []
      : verified.failures.map(({ code, file, expected, actual }) => ({
          code,
          file,
          expected,
          actual,
        }));

    expect({ ok: verified.ok, integrity: verified.integrity ?? null, failures }, vector.id).toEqual(
      {
        ...vector.expected,
        failures: vector.expected.failures.map(({ code, file, expected, actual }) => ({
          code,
          file,
          expected,
          actual,
        })),
      },
    );
  }

  for (const vector of committed().archives) {
    const read = readBundleTarball(Buffer.from(vector.base64, "base64"));

    expect(
      read.ok
        ? read.entries.map((entry) => entry.path)
        : read.failures.map((failure) => failure.code),
      vector.id,
    ).toEqual(
      vector.expected.ok
        ? vector.expected.paths
        : vector.expected.failures.map((failure) => failure.code),
    );
  }
});

test("integrity matches the vectors", () => {
  for (const vector of committed().directories.filter((candidate) => candidate.expected.ok)) {
    const listed = vector.files
      .filter((file) => file.path.startsWith("sources/") || file.path.startsWith("ir/"))
      .map((file) => ({
        path: file.path,
        sha256: bundleSha256Hex(Buffer.from(file.base64, "base64")),
      }));

    expect(canonicalBundleFileList(listed).split("\n").length, vector.id).toBe(listed.length + 1);
    expect(bundleIntegrity(listed), vector.id).toBe(vector.expected.integrity);
  }
});
