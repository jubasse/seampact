import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPTS = resolve(import.meta.dirname, "python");

// A stand-in `seampact`: it fails unless the cache is absolute, writes the files `local-yaml.sh` looks for, and
// refuses the tampered copies the way the real command names them.
const FAKE_SEAMPACT = `#!/bin/sh
case "\${XDG_CACHE_HOME:-/}" in /*) ;; *) echo "relative XDG_CACHE_HOME" >&2; exit 1 ;; esac
if [ "$1" = generate ]; then
  mkdir -p generated openapi
  : > generated/x.py
  : > openapi/x.yaml
  if grep -q tampered seampact.config.yaml 2>/dev/null; then
    echo "bundle.file-hash: tampered.json" >&2
    exit 1
  fi
fi
`;

// A stand-in `uv`: it records the file it was asked to fill, to see where it wrote.
const FAKE_UV = `#!/bin/sh
case "$1" in
  export) echo "pkg==1 --hash=sha256:00" ;;
  tree) echo "server v1" ;;
esac
`;

let sandbox: string;

function writeExecutable(path: string, content: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function runRelative(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", [join(SCRIPTS, script), ...args], {
    cwd: sandbox,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "seampact-relative-"));
  writeExecutable(join(sandbox, "venv/bin/seampact"), FAKE_SEAMPACT);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("the Python consumer scripts with relative path arguments", () => {
  it("local-yaml.sh resolves work, venv and binary before it changes directory", () => {
    writeExecutable(join(sandbox, "bin/seampact-binary"), "#!/bin/sh\n");

    const run = runRelative("local-yaml.sh", ["work", "venv", "bin/seampact-binary", "seampact-fastapi"]);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(existsSync(join(sandbox, "work/fastapi/generated/x.py"))).toBe(true);
  });

  it("channel-smoke.sh resolves work, venv and served and makes the cache absolute", () => {
    const served = {
      integrity: "sha256-x",
      tamperedFile: "tampered.json",
      release: { url: "https://r/ok", tamperedUrl: "https://r/tampered", caFile: "ca.pem" },
      git: { url: "file:///g", directory: "bundle", tag: "v1", tamperedTag: "tampered" },
    };
    writeFileSync(join(sandbox, "served.json"), JSON.stringify(served));

    const run = runRelative("channel-smoke.sh", ["work", "venv", "served.json", "seampact-fastapi"]);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("channel-smoke.sh makes a relative XDG_CACHE_HOME absolute", () => {
    const served = {
      integrity: "sha256-x",
      tamperedFile: "tampered.json",
      release: { url: "https://r/ok", tamperedUrl: "https://r/tampered", caFile: "ca.pem" },
      git: { url: "file:///g", directory: "bundle", tag: "v1", tamperedTag: "tampered" },
    };
    writeFileSync(join(sandbox, "served.json"), JSON.stringify(served));

    const run = runRelative("channel-smoke.sh", ["work", "venv", "served.json", "seampact-fastapi"], {
      XDG_CACHE_HOME: "cache",
    });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("requirements.sh writes its output where the relative path points from the caller", () => {
    writeExecutable(join(sandbox, "fakebin/uv"), FAKE_UV);

    const run = runRelative("requirements.sh", ["requirements.txt", "seampact-fastapi", "generate", "server"], {
      PATH: `${join(sandbox, "fakebin")}:${process.env.PATH}`,
    });

    expect(run.stderr).not.toContain("No such file");
    expect(existsSync(join(sandbox, "requirements.txt"))).toBe(true);
    expect(readFileSync(join(sandbox, "requirements.txt"), "utf8")).toContain("pkg==1");
  });
});
