import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { serverRuntimeRefusals } from "../../../core/codegen-core/src/node-server/server-runtime-check.js";
import { refuseCodeOfOtherVersion } from "./generator-version-check.js";

// The generate-time check (G2, in codegen-core) and the boot check (G3, here) compare versions with two small
// functions, since neither package may import the other; these vectors keep their verdicts equal.

interface VersionVector {
  readonly installed: string;
  readonly generator: string;
  readonly serves: boolean;
}

const VERSION_VECTORS: readonly VersionVector[] = [
  { installed: "1.4.2", generator: "1.4.2", serves: true },
  { installed: "1.4.3", generator: "1.4.2", serves: true },
  { installed: "1.4.1", generator: "1.4.2", serves: false },
  { installed: "1.5.0", generator: "1.4.2", serves: false },
  { installed: "1.3.9", generator: "1.4.2", serves: false },
  { installed: "2.4.2", generator: "1.4.2", serves: false },
  { installed: "0.3.1", generator: "0.3.0", serves: true },
  { installed: "0.4.0", generator: "0.3.0", serves: false },
  { installed: "0.0.1", generator: "0.0.0", serves: true },
  { installed: "0.0.0", generator: "0.0.1", serves: false },
  { installed: "1.4.10", generator: "1.4.9", serves: true },
  { installed: "1.4.9", generator: "1.4.10", serves: false },
  { installed: "1.4.2-rc.1", generator: "1.4.2", serves: false },
  { installed: "1.4.2", generator: "1.4.2-rc.1", serves: false },
  { installed: "1.4.2-rc.1", generator: "1.4.2-rc.1", serves: true },
  { installed: "1.4.2+build.5", generator: "1.4.2", serves: false },
  { installed: "1.4.2", generator: "1.4.2+build.5", serves: false },
  { installed: "01.4.2", generator: "1.4.2", serves: false },
  { installed: " 1.4.2", generator: "1.4.2", serves: false },
  { installed: "v1.4.2", generator: "1.4.2", serves: false },
];

const apps: string[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) rmSync(app, { recursive: true, force: true });
});

// The api's output directory under a fresh app that installs the runtime at `version`.
function outputUnderAppWithRuntime(version: string): string {
  const app = mkdtempSync(join(tmpdir(), "seampact-version-vector-"));
  const runtime = join(app, "node_modules", "@seampact", "server-runtime");

  apps.push(app);
  mkdirSync(runtime, { recursive: true });
  writeFileSync(
    join(runtime, "package.json"),
    JSON.stringify({ name: "@seampact/server-runtime", exports: { "./version": "./version.cjs" } }),
  );
  writeFileSync(
    join(runtime, "version.cjs"),
    `exports.SERVER_RUNTIME_VERSION = ${JSON.stringify(version)};\n`,
  );

  return join(app, "src", "generated", "tasks");
}

function generateTimeServes(vector: VersionVector): boolean {
  const generator = { packageName: "@seampact/codegen-express", packageVersion: vector.generator };

  return serverRuntimeRefusals(outputUnderAppWithRuntime(vector.installed), generator).length === 0;
}

function bootTimeServes(vector: VersionVector): boolean {
  try {
    refuseCodeOfOtherVersion({ id: "tasks", generatorVersion: vector.generator }, vector.installed);

    return true;
  } catch {
    return false;
  }
}

describe.each(VERSION_VECTORS)("runtime $installed, generator $generator", (vector) => {
  test("the generate-time check gives the expected verdict", () => {
    expect(generateTimeServes(vector)).toBe(vector.serves);
  });

  test("the boot check gives the same verdict", () => {
    expect(bootTimeServes(vector)).toBe(vector.serves);
  });
});
