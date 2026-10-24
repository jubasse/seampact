import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { REFERENCE, temporaryDirectory } from "./bundle.test-support.js";
import { referenceTarball } from "./reference-tarball.test-support.js";
import { readBundleTarball } from "./tarball-read.js";

const REPOSITORY = fileURLToPath(new URL("../../../../../", import.meta.url));
const SCRIPT = fileURLToPath(new URL("./reference-tarball.test-support.ts", import.meta.url));
const OWNER_ONLY = 0o600;
const SOME_DAY = new Date("2001-02-03T04:05:06Z");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// The reference contract copied file by file in reverse order, owner-only and with another modification time.
function reversedCopy(): string {
  const copy = temporaryDirectory();
  const files = readdirSync(REFERENCE, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(REFERENCE, join(entry.parentPath, entry.name)))
    .sort()
    .reverse();

  for (const file of files) {
    const target = join(copy, file);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(REFERENCE, file)));
    chmodSync(target, OWNER_ONLY);
    utimesSync(target, SOME_DAY, SOME_DAY);
  }

  return copy;
}

// Slow on a loaded machine: give it more than the default limit.
const TEST_TIMEOUT_MILLISECONDS = 60_000;

test(
  "tarball is byte-reproducible",
  () => {
    const tarball = referenceTarball();

    // Another file creation order, mode and modification time.
    expect(sha256(referenceTarball(reversedCopy()))).toBe(sha256(tarball));

    // Another process, time zone, locale and umask.
    const output = join(temporaryDirectory(), "reference.tgz");
    const printed = execFileSync(
      process.execPath,
      [
        "--experimental-transform-types",
        "--no-warnings",
        "--import",
        "./scripts/ir-models/register.ts",
        SCRIPT,
        output,
      ],
      {
        cwd: REPOSITORY,
        env: {
          ...process.env,
          TZ: "Pacific/Kiritimati",
          LANG: "tr_TR.UTF-8",
          LC_ALL: "tr_TR.UTF-8",
        },
      },
    );

    expect(printed.toString().trim()).toBe(sha256(tarball));
    expect(sha256(readFileSync(output))).toBe(sha256(tarball));

    // Fixed metadata: the gzip header and every ustar header.
    expect([...tarball.subarray(4, 10)]).toEqual([0, 0, 0, 0, 2, 255]);
    const read = readBundleTarball(tarball);

    expect(read.ok && read.entries.map((entry) => entry.path)).toEqual([
      "ir/tasks.json",
      "ir/tasksService.json",
      "seampact-bundle.json",
      ...readdirSync(REFERENCE, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map(
          (entry) =>
            `sources/${relative(REFERENCE, join(entry.parentPath, entry.name)).split(sep).join("/")}`,
        )
        .sort(),
    ]);
  },
  TEST_TIMEOUT_MILLISECONDS,
);
