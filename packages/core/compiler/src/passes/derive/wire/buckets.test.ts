import { describe, expect, test } from "vitest";
import {
  deriveWireLocated,
  deriveWireReferenceVariant,
  deriveWireRunContract,
} from "./test-support.js";

const WRITE_BUCKET = "write: { key: [principal.userId], limit: 60, window: 1m }";

function runWithWriteBucket(written: string) {
  const variant = deriveWireReferenceVariant("shared/base.yaml", [[WRITE_BUCKET, written]]);

  return deriveWireRunContract(variant, "tasks");
}

describe("bucket limits", () => {
  test("a bucket that sets its limit and window has no warning", () => {
    expect(runWithWriteBucket(WRITE_BUCKET).diagnostics).toEqual([]);
  });

  test("a bucket without limit and window is warned about once, at its declaration", () => {
    const run = runWithWriteBucket("write: { key: [principal.userId] }");

    expect(run.diagnostics.map(deriveWireLocated)).toEqual([
      { rule: "seampact/derive/bucket-limits", pointer: "/buckets/write", related: [] },
    ]);
    expect(
      run.diagnostics.map(({ severity, message, fix }) => ({ severity, message, fix })),
    ).toEqual([
      {
        severity: "warning",
        message: "The bucket 'write' sets no limit and window, so the server binds them.",
        fix: "Set limit and window on the bucket 'write', or bind them in the server.",
      },
    ]);
  });

  test("a bucket without a window is warned about that member only", () => {
    const run = runWithWriteBucket("write: { key: [principal.userId], limit: 60 }");

    expect(run.diagnostics.map(({ severity, message }) => ({ severity, message }))).toEqual([
      {
        severity: "warning",
        message: "The bucket 'write' sets no window, so the server binds it.",
      },
    ]);
  });

  test("a bucket without a limit is warned about that member only", () => {
    const run = runWithWriteBucket("write: { key: [principal.userId], window: 1m }");

    expect(run.diagnostics.map(({ message }) => message)).toEqual([
      "The bucket 'write' sets no limit, so the server binds it.",
    ]);
  });
});
