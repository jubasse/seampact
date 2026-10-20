import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";
import { REPO_ROOT } from "../golden/repo-root.ts";
import {
  REFERENCE_WORKSPACE,
  SMOKE_PACKAGE,
  SMOKE_TAMPERED_FILE,
  SMOKE_TAMPERED_PACKAGE,
  SMOKE_VERSION,
  tamperFile,
} from "./bundles.ts";
import {
  RELEASE_PATH,
  RELEASE_TAMPERED_PATH,
  type SmokeChannels,
  serveSmokeChannels,
} from "./channels.ts";
import { runSeampact } from "./cli-process.ts";
import { SMOKE_GIT_DIRECTORY, SMOKE_GIT_TAG, SMOKE_GIT_TAMPERED_TAG } from "./git-repository.ts";
import { isolatedNpmEnvironment } from "./registry.ts";
import { generatedFiles, smokeConfig, writeSmokeApp } from "./smoke-app.ts";

// The channel smoke tests (ADR 0011, CHK-101): the Node CLI generates from a bundle fetched over each channel the
// files it generates from the `path` source, refuses a tampered copy served by the same channel, and reads the
// second fetch from the cache, checked again.

const run = promisify(execFile);

const SMOKE_TEST_TIMEOUT_MILLISECONDS = 180_000;
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const IMPORTS_FIXTURE = join(REPO_ROOT, "fixtures/bundle-channels/imports");
const GOLDEN_SERVICE_IR = join(REPO_ROOT, "fixtures/golden/reference/tasksService.ir.json");
const PINNED_INTEGRITY = /integrity: (sha256-[A-Za-z0-9+/]+=*)/u;

let work: string;
let channels: SmokeChannels;
let pathOutput: Map<string, string>;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "seampact-dist-smoke-"));
  channels = await serveSmokeChannels(join(work, "channels"));

  const pathApp = join(work, "path-app");

  writeSmokeApp(pathApp, smokeConfig(`{ path: ${JSON.stringify(REFERENCE_WORKSPACE)} }`));

  const generated = await runSeampact(["generate"], pathApp, {});

  expect(generated.stderr).toBe("");
  pathOutput = generatedFiles(pathApp);
}, SMOKE_TEST_TIMEOUT_MILLISECONDS);

afterAll(async () => {
  await channels?.close();
  rmSync(work, { recursive: true, force: true });
});

function cacheEnvironment(name: string): { SEAMPACT_CACHE_DIR: string } {
  return { SEAMPACT_CACHE_DIR: join(work, `cache-${name}`) };
}

function releaseSource(path: string, integrity: string | undefined): string {
  const pin = integrity === undefined ? "" : `, integrity: "${integrity}"`;

  return `{ release: { url: "${channels.release.url}${path}" }${pin} }`;
}

test(
  "npm channel smoke",
  async () => {
    const app = join(work, "npm-app");

    mkdirSync(app);
    writeFileSync(
      join(app, "package.json"),
      JSON.stringify({
        name: "npm-smoke-app",
        private: true,
        dependencies: { [SMOKE_PACKAGE]: SMOKE_VERSION, [SMOKE_TAMPERED_PACKAGE]: SMOKE_VERSION },
      }),
    );
    await run(
      NPM,
      ["install", "--registry", channels.registry.url, "--no-package-lock", "--ignore-scripts"],
      {
        cwd: app,
        env: isolatedNpmEnvironment(work),
        shell: process.platform === "win32",
      },
    );

    const integrity = channels.bundles.integrity;

    writeSmokeApp(
      app,
      smokeConfig(
        `{ package: ${SMOKE_PACKAGE}, version: ${SMOKE_VERSION}, integrity: "${integrity}" }`,
      ),
    );
    expect((await runSeampact(["generate"], app, cacheEnvironment("npm"))).exitCode).toBe(0);
    expect(generatedFiles(app)).toEqual(pathOutput);

    // An installed package is read where it is, and checked on every run.
    expect((await runSeampact(["generate"], app, cacheEnvironment("npm"))).exitCode).toBe(0);

    writeSmokeApp(
      app,
      smokeConfig(
        `{ package: ${SMOKE_TAMPERED_PACKAGE}, version: ${SMOKE_VERSION}, integrity: "${integrity}" }`,
      ),
    );
    const tampered = await runSeampact(["generate"], app, cacheEnvironment("npm"));

    expect(tampered.exitCode).toBe(1);
    expect(tampered.stderr).toContain("bundle.file-hash");
    expect(tampered.stderr).toContain(SMOKE_TAMPERED_FILE);
  },
  SMOKE_TEST_TIMEOUT_MILLISECONDS,
);

test(
  "release channel smoke",
  async () => {
    const app = join(work, "release-app");
    const env = { ...cacheEnvironment("release"), NODE_EXTRA_CA_CERTS: channels.release.caFile };
    const integrity = channels.bundles.integrity;

    writeSmokeApp(app, smokeConfig(releaseSource(RELEASE_PATH, integrity)));
    expect((await runSeampact(["generate"], app, env)).exitCode).toBe(0);
    expect(generatedFiles(app)).toEqual(pathOutput);
    expect(channels.release.requestCount(RELEASE_PATH)).toBe(1);

    expect((await runSeampact(["generate"], app, env)).exitCode).toBe(0);
    expect(channels.release.requestCount(RELEASE_PATH)).toBe(1);

    // A URL a clean machine would refuse is refused before the cache is read.
    const insecureUrl = channels.release.url.replace(/^https:/u, "http:");

    writeSmokeApp(
      app,
      smokeConfig(
        `{ release: { url: "${insecureUrl}${RELEASE_PATH}" }, integrity: "${integrity}" }`,
      ),
    );
    const insecure = await runSeampact(["generate"], app, env);

    expect(insecure.exitCode).toBe(1);
    expect(insecure.stderr).toContain("bundle.release-url");
    writeSmokeApp(app, smokeConfig(releaseSource(RELEASE_PATH, integrity)));

    // The cache entry is checked again on every read.
    const [entry = ""] = readdirSync(join(env.SEAMPACT_CACHE_DIR, "bundles"));

    tamperFile(join(env.SEAMPACT_CACHE_DIR, "bundles", entry));

    const cacheTampered = await runSeampact(["generate"], app, env);

    expect(cacheTampered.exitCode).toBe(1);
    expect(cacheTampered.stderr).toContain("bundle.cache-invalid");
    expect(cacheTampered.stderr).toContain(SMOKE_TAMPERED_FILE);

    // The cache is by integrity, so the tampered copy under the same pin is fetched with an empty cache.
    writeSmokeApp(app, smokeConfig(releaseSource(RELEASE_TAMPERED_PATH, integrity)));
    const tampered = await runSeampact(["generate"], app, {
      ...env,
      ...cacheEnvironment("release-tampered"),
    });

    expect(tampered.exitCode).toBe(1);
    expect(tampered.stderr).toContain("bundle.file-hash");
    expect(tampered.stderr).toContain(SMOKE_TAMPERED_FILE);
  },
  SMOKE_TEST_TIMEOUT_MILLISECONDS,
);

test(
  "git channel smoke",
  async () => {
    const app = join(work, "git-app");
    const env = cacheEnvironment("git");
    const integrity = channels.bundles.integrity;
    const gitSource = (tag: string) =>
      `{ git: { url: "${channels.git.url}", tag: ${tag}, directory: ${SMOKE_GIT_DIRECTORY} }, integrity: "${integrity}" }`;

    writeSmokeApp(app, smokeConfig(gitSource(SMOKE_GIT_TAG)));
    expect((await runSeampact(["generate"], app, env)).exitCode).toBe(0);
    expect(generatedFiles(app)).toEqual(pathOutput);

    // With the repository gone, the second run can only read the cache.
    const moved = `${channels.git.bare}-moved`;

    renameSync(channels.git.bare, moved);

    try {
      expect((await runSeampact(["generate"], app, env)).exitCode).toBe(0);
    } finally {
      renameSync(moved, channels.git.bare);
    }

    // The cache is by integrity, so the tampered copy under the same pin is fetched with an empty cache.
    writeSmokeApp(app, smokeConfig(gitSource(SMOKE_GIT_TAMPERED_TAG)));
    const tampered = await runSeampact(["generate"], app, cacheEnvironment("git-tampered"));

    expect(tampered.exitCode).toBe(1);
    expect(tampered.stderr).toContain("bundle.file-hash");
    expect(tampered.stderr).toContain(SMOKE_TAMPERED_FILE);

    // A local repository is refused even when its bundle is cached.
    writeSmokeApp(app, smokeConfig(gitSource(SMOKE_GIT_TAG)));
    const refused = await runSeampact(["generate"], app, { ...env, SEAMPACT_ALLOW_LOCAL: "false" });

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("bundle.source-local");
  },
  SMOKE_TEST_TIMEOUT_MILLISECONDS,
);

test(
  "git fetch leaves the repository GIT_DIR names untouched",
  async () => {
    // Git exports GIT_DIR to its hooks, so a generate run from a pre-commit hook inherits the user's repository.
    const app = join(work, "git-dir-app");
    const userRepository = join(work, "user-repository");
    const userGitDirectory = join(userRepository, ".git");
    const git = (...args: string[]) => run("git", ["-C", userRepository, ...args]);

    mkdirSync(userRepository, { recursive: true });
    await git("init", "--quiet");
    await git(
      "-c",
      "user.name=smoke",
      "-c",
      "user.email=smoke@seampact.invalid",
      "commit",
      "--quiet",
      "--allow-empty",
      "--message",
      "One.",
    );

    const source = `{ git: { url: "${channels.git.url}", tag: ${SMOKE_GIT_TAG}, directory: ${SMOKE_GIT_DIRECTORY} }, integrity: "${channels.bundles.integrity}" }`;

    writeSmokeApp(app, smokeConfig(source));
    const generated = await runSeampact(["generate"], app, {
      ...cacheEnvironment("git-dir"),
      GIT_DIR: userGitDirectory,
    });

    expect(generated.stderr).toBe("");
    expect(generated.exitCode).toBe(0);
    expect((await git("rev-parse", "--is-shallow-repository")).stdout.trim()).toBe("false");
    expect(existsSync(join(userGitDirectory, "FETCH_HEAD"))).toBe(false);
  },
  SMOKE_TEST_TIMEOUT_MILLISECONDS,
);

test(
  "missing pin prints the actual integrity",
  async () => {
    const app = join(work, "pin-app");
    const env = { ...cacheEnvironment("pin"), NODE_EXTRA_CA_CERTS: channels.release.caFile };

    writeSmokeApp(app, smokeConfig(releaseSource(RELEASE_PATH, undefined)));
    const unpinned = await runSeampact(["generate"], app, env);
    const printed = PINNED_INTEGRITY.exec(unpinned.stderr)?.[1];

    expect(unpinned.exitCode).toBe(1);
    expect(unpinned.stderr).toContain("bundle.pin-missing");
    expect(printed).toBe(channels.bundles.integrity);

    writeSmokeApp(app, smokeConfig(releaseSource(RELEASE_PATH, printed)));
    expect((await runSeampact(["generate"], app, env)).exitCode).toBe(0);
    expect(generatedFiles(app)).toEqual(pathOutput);
  },
  SMOKE_TEST_TIMEOUT_MILLISECONDS,
);

test(
  "relay to an imported api matches the sibling relay",
  async () => {
    const app = join(work, "imports-app");
    const env = { ...cacheEnvironment("imports"), NODE_EXTRA_CA_CERTS: channels.release.caFile };
    const writeWorkspace = (api: string, integrity: string) =>
      writeFileSync(
        join(app, "contract", "workspace.yaml"),
        readFileSync(join(IMPORTS_FIXTURE, "workspace.template.yaml"), "utf8")
          .replace("{{releaseUrl}}", `${channels.release.url}${RELEASE_PATH}`)
          .replace("{{api}}", api)
          .replace("{{integrity}}", integrity),
      );

    cpSync(IMPORTS_FIXTURE, join(app, "contract"), { recursive: true });
    writeSmokeApp(
      app,
      'sources:\n  contract: { path: ./contract }\ntargets:\n  - { id: service, use: "@seampact/codegen-ts", api: tasksService }\n',
    );
    writeWorkspace("tasks", channels.bundles.integrity);

    const compiled = await runSeampact(["compile", "--out", "ir"], app, env);

    expect(compiled.stderr).toBe("");
    expect(readFileSync(join(app, "ir", "tasksService.ir.json"), "utf8")).toBe(
      readFileSync(GOLDEN_SERVICE_IR, "utf8"),
    );

    writeWorkspace("tasks", `sha256-${"A".repeat(43)}=`);
    const wrongPin = await runSeampact(["compile"], app, env);

    expect(wrongPin.exitCode).toBe(1);
    expect(wrongPin.stderr).toContain("bundle.pin-mismatch");
    expect(wrongPin.stderr).toContain("workspace.imports.tasks");

    writeWorkspace("billing", channels.bundles.integrity);
    const absentApi = await runSeampact(["compile"], app, env);

    expect(absentApi.exitCode).toBe(1);
    expect(absentApi.stderr).toContain("bundle.import-api-missing");
    expect(absentApi.stderr).toContain("'billing'");
    expect(absentApi.stderr).toContain("'tasks', 'tasksService'");
  },
  SMOKE_TEST_TIMEOUT_MILLISECONDS,
);

test(
  "local sources refused on shared branches",
  async () => {
    const app = join(work, "local-app");
    const pathSource = `{ path: ${JSON.stringify(REFERENCE_WORKSPACE)} }`;

    writeSmokeApp(app, `allowLocal: false\n${smokeConfig(pathSource)}`);

    for (const command of ["compile", "generate"]) {
      const refused = await runSeampact([command], app, {});

      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("config.source.local");
      expect(refused.stderr).toContain("source 'contract'");
      expect(refused.stderr).toContain("allowLocal: false");
      expect(refused.stderr).toContain("pinned bundle source");
    }

    const notLifted = await runSeampact(["compile"], app, { SEAMPACT_ALLOW_LOCAL: "true" });

    expect(notLifted.exitCode).toBe(1);
    expect(notLifted.stderr).toContain("config.source.local");

    writeSmokeApp(app, smokeConfig(pathSource));
    const forced = await runSeampact(["compile"], app, { SEAMPACT_ALLOW_LOCAL: "false" });

    expect(forced.exitCode).toBe(1);
    expect(forced.stderr).toContain("SEAMPACT_ALLOW_LOCAL=false");
    expect((await runSeampact(["compile"], app, {})).exitCode).toBe(0);
  },
  SMOKE_TEST_TIMEOUT_MILLISECONDS,
);
