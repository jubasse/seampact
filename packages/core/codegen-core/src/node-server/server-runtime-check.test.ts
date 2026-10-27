import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  RUNTIME_MISSING,
  RUNTIME_VERSION_MISMATCH,
  serverRuntimeRefusals,
} from "./server-runtime-check.js";

// The generate-time check of the runtime package, against an app that installs it at a given version.

const GENERATOR = { packageName: "@seampact/codegen-express", packageVersion: "1.4.2" };

let app: string;

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), "seampact-runtime-check-"));
});

afterEach(() => {
  rmSync(app, { recursive: true, force: true });
});

// The api's output directory, not written yet, under an app that installs the runtime at `version`.
function outputUnderAppWithRuntime(version: string | undefined): string {
  if (version !== undefined) {
    const runtime = join(app, "node_modules", "@seampact", "server-runtime");

    mkdirSync(runtime, { recursive: true });
    writeFileSync(
      join(runtime, "package.json"),
      JSON.stringify({
        name: "@seampact/server-runtime",
        exports: { "./version": "./version.cjs" },
      }),
    );
    writeFileSync(
      join(runtime, "version.cjs"),
      `exports.SERVER_RUNTIME_VERSION = ${JSON.stringify(version)};\n`,
    );
  }

  return join(app, "src", "generated", "tasks");
}

describe("the generate-time check of @seampact/server-runtime", () => {
  test("refuses an app that does not install the runtime, with the install line", () => {
    expect(serverRuntimeRefusals(outputUnderAppWithRuntime(undefined), GENERATOR)).toEqual([
      {
        code: RUNTIME_MISSING,
        message:
          "`@seampact/codegen-express 1.4.2` generates code that imports `@seampact/server-runtime`, which this app does not install.",
        fix: "Install it as a production dependency at the generator's version: `npm install @seampact/server-runtime@1.4.2`.",
      },
    ]);
  });

  test("refuses a runtime of another major.minor", () => {
    expect(serverRuntimeRefusals(outputUnderAppWithRuntime("1.5.0"), GENERATOR)).toEqual([
      {
        code: RUNTIME_VERSION_MISMATCH,
        message:
          "`@seampact/server-runtime 1.5.0` is installed, `@seampact/codegen-express 1.4.2` generates for `1.4.x`.",
        fix: "Install the runtime at the generator's version (`npm install @seampact/server-runtime@1.4.2`), or move the generator to the runtime's version, `1.5.0`.",
      },
    ]);
  });

  test("refuses a runtime of the same major.minor with a lower patch", () => {
    expect(serverRuntimeRefusals(outputUnderAppWithRuntime("1.4.1"), GENERATOR)).toEqual([
      {
        code: RUNTIME_VERSION_MISMATCH,
        message:
          "`@seampact/server-runtime 1.4.1` is older than the generator, `@seampact/codegen-express 1.4.2`.",
        fix: "Install the runtime at `1.4.2` or a later patch: `npm install @seampact/server-runtime@1.4.2`.",
      },
    ]);
  });

  test("passes the generator's version and a later patch", () => {
    expect(serverRuntimeRefusals(outputUnderAppWithRuntime("1.4.2"), GENERATOR)).toEqual([]);
    rmSync(join(app, "node_modules"), { recursive: true, force: true });
    expect(serverRuntimeRefusals(outputUnderAppWithRuntime("1.4.9"), GENERATOR)).toEqual([]);
  });
});
