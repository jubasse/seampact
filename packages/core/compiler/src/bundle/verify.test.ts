import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { IR_REVISION } from "@seampact/spec/ir";
import { afterAll, beforeAll, expect, test } from "vitest";
import { referenceBuildOptions, temporaryDirectory } from "./bundle.test-support.js";
import { resealBundle } from "./reseal.test-support.js";
import { extractBundleTarball } from "./tarball-read.js";
import { verifyBundle } from "./verify.js";
import { writeBundle } from "./write.js";

let pristine: string;
let pin: string;

// Made once for the file, so the per-test cleanup of `temporaryDirectory` leaves it alone.
beforeAll(() => {
  pristine = join(mkdtempSync(join(tmpdir(), "seampact-bundle-test-")), "reference");
  const written = writeBundle({ ...referenceBuildOptions(), output: { directory: pristine } });

  if (!written.ok) throw new Error("the reference contract was not bundled");
  pin = written.manifest.integrity;
});

afterAll(() => rmSync(dirname(pristine), { recursive: true, force: true }));

// A copy of the reference bundle, changed by `tamper`.
function tampered(tamper: (directory: string) => void): string {
  const copy = join(temporaryDirectory(), "bundle");

  cpSync(pristine, copy, { recursive: true });
  tamper(copy);

  return copy;
}

function flipFirstByte(file: string): void {
  const bytes = readFileSync(file);

  bytes[0] = (bytes[0] ?? 0) ^ 1;
  writeFileSync(file, bytes);
}

test("pinned check refuses each tamper", () => {
  const untouched = verifyBundle(pristine, pin);

  expect(untouched.ok && [...untouched.irs.keys()]).toEqual(["tasks", "tasksService"]);

  // Step 1: each file against the manifest.
  expect(
    verifyBundle(
      tampered((bundle) => flipFirstByte(join(bundle, "sources/tasks/api.yaml"))),
      pin,
    ),
  ).toMatchObject({
    ok: false,
    failures: [
      {
        code: "bundle.file-hash",
        file: "sources/tasks/api.yaml",
        expected: expect.any(String),
        actual: expect.any(String),
      },
    ],
  });
  expect(
    verifyBundle(
      tampered((bundle) => flipFirstByte(join(bundle, "ir/tasks.json"))),
      pin,
    ),
  ).toMatchObject({
    failures: [{ code: "bundle.file-hash", file: "ir/tasks.json" }],
  });
  expect(
    verifyBundle(
      tampered((bundle) => writeFileSync(join(bundle, "sources/tasks/api.yaml"), "x")),
      pin,
    ),
  ).toMatchObject({
    failures: [{ code: "bundle.file-size", file: "sources/tasks/api.yaml", actual: "1" }],
  });
  expect(
    verifyBundle(
      tampered((bundle) => writeFileSync(join(bundle, "sources/extra.yaml"), "x")),
      pin,
    ),
  ).toMatchObject({
    failures: [{ code: "bundle.file-unlisted", file: "sources/extra.yaml" }],
  });
  expect(
    verifyBundle(
      tampered((bundle) => rmSync(join(bundle, "sources/shared/base.yaml"))),
      pin,
    ),
  ).toMatchObject({
    failures: [{ code: "bundle.file-missing", file: "sources/shared/base.yaml" }],
  });

  // Step 2: the integrity, then the pin; a missing or wrong pin gives the actual value.
  const otherIntegrity = `sha256-${"A".repeat(43)}=`;
  const editedIntegrity = tampered((bundle) => {
    const file = join(bundle, "seampact-bundle.json");

    writeFileSync(file, readFileSync(file, "utf8").replace(pin, otherIntegrity));
  });

  expect(verifyBundle(editedIntegrity, otherIntegrity)).toEqual({
    ok: false,
    failures: [
      expect.objectContaining({
        code: "bundle.integrity-mismatch",
        expected: otherIntegrity,
        actual: pin,
      }),
    ],
    integrity: pin,
  });
  expect(verifyBundle(pristine, otherIntegrity)).toEqual({
    ok: false,
    failures: [
      expect.objectContaining({
        code: "bundle.pin-mismatch",
        expected: otherIntegrity,
        actual: pin,
      }),
    ],
    integrity: pin,
  });
  expect(verifyBundle(pristine, undefined)).toEqual({
    ok: false,
    failures: [
      expect.objectContaining({
        code: "bundle.pin-missing",
        actual: pin,
        fix: expect.stringContaining(pin),
      }),
    ],
    integrity: pin,
  });

  // Step 3: an IR of another revision, resealed so steps 1 and 2 pass.
  let resealed = "";
  const otherRevision = tampered((bundle) => {
    const file = join(bundle, "ir/tasks.json");

    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        `"irRevision": ${IR_REVISION}`,
        `"irRevision": ${IR_REVISION - 1}`,
      ),
    );
    resealed = resealBundle(bundle, (manifest) => ({
      ...manifest,
      apis: manifest.apis.map((api) =>
        api.name === "tasks" ? { ...api, irRevision: IR_REVISION - 1 } : api,
      ),
    }));
  });

  expect(verifyBundle(otherRevision, resealed)).toMatchObject({
    failures: [
      {
        code: "bundle.ir-revision",
        file: "ir/tasks.json",
        expected: String(IR_REVISION),
        actual: String(IR_REVISION - 1),
      },
    ],
  });
});

test("the manifest is checked before any file", () => {
  const unknownMember = tampered((bundle) => {
    const file = join(bundle, "seampact-bundle.json");

    writeFileSync(file, readFileSync(file, "utf8").replace("{", '{\n  "extra": 1,'));
  });

  expect(verifyBundle(unknownMember, pin)).toMatchObject({
    failures: [{ code: "bundle.manifest-invalid", file: "seampact-bundle.json" }],
  });

  const prototypeKey = tampered((bundle) => {
    const file = join(bundle, "seampact-bundle.json");

    writeFileSync(
      file,
      readFileSync(file, "utf8").replace('"contract": {', '"contract": {\n    "__proto__": {},'),
    );
  });

  expect(verifyBundle(prototypeKey, pin)).toMatchObject({
    failures: [
      { code: "bundle.manifest-invalid", message: expect.stringContaining("/contract/__proto__") },
    ],
  });
  expect(
    verifyBundle(
      tampered((bundle) => rmSync(join(bundle, "seampact-bundle.json"))),
      pin,
    ),
  ).toMatchObject({
    failures: [{ code: "bundle.manifest-missing" }],
  });
});

test("npm's own files are allowed on a package source only, links never", () => {
  const npmPackage = tampered((bundle) => {
    writeFileSync(join(bundle, "package.json"), "{}");
    writeFileSync(join(bundle, "README.md"), "# contract");
  });

  expect(verifyBundle(npmPackage, pin, { channel: "package" }).ok).toBe(true);
  expect(verifyBundle(npmPackage, pin, { channel: "release" })).toMatchObject({
    failures: [
      { code: "bundle.file-unlisted", file: "README.md" },
      { code: "bundle.file-unlisted", file: "package.json" },
    ],
  });

  const linked = tampered((bundle) =>
    symlinkSync("../../ir/tasks.json", join(bundle, "sources/link.json")),
  );

  expect(verifyBundle(linked, pin)).toMatchObject({
    failures: [{ code: "bundle.file-type", file: "sources/link.json" }],
  });
});

test("an extracted tarball verifies like the directory", () => {
  const tarball = join(temporaryDirectory(), "reference.tgz");

  expect(writeBundle({ ...referenceBuildOptions(), output: { tarball } }).ok).toBe(true);
  const extracted = extractBundleTarball(readFileSync(tarball));

  if (!extracted.ok) throw new Error(JSON.stringify(extracted.failures));

  try {
    expect(verifyBundle(extracted.directory, pin).ok).toBe(true);
  } finally {
    rmSync(extracted.directory, { recursive: true, force: true });
  }
});
