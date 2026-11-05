import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { releaseVersionEdits } from "../release/version-plan.ts";
import { packageDirectories } from "../workspace/index.ts";
import { checkPackageRules, formatViolation } from "./rules.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const fixture = (name: string, side: "pass" | "fail" | "empty-readme") =>
  checkPackageRules(join(HERE, "fixtures", name, side)).map(formatViolation);

/** A case passes in `pass` and, in `fail`, yields exactly the expected rule and message parts. */
function proves(name: string, rule: string, file: string, ...parts: string[]) {
  expect(fixture(name, "pass"), `${name}/pass`).toEqual([]);
  const out = fixture(name, "fail");

  expect(out, `${name}/fail`).toHaveLength(1);
  expect(out[0]).toContain(`${file}: ${rule}: `);

  for (const p of parts) expect(out[0]).toContain(p);
}

const trees: string[] = [];

afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

function writeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "package-rules-"));

  trees.push(root);

  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }

  return root;
}

const RELEASE = "1.2.3";
const PUBLISHED = ["packages/spec", "packages/lint"];

// The public metadata the `metadata` rule asks of a published package.
function publicMetadata(directory: string): Record<string, unknown> {
  return {
    repository: { type: "git", url: "git+https://github.com/jubasse/seampact.git", directory },
    homepage: "https://jubasse.github.io/seampact/",
    bugs: { url: "https://github.com/jubasse/seampact/issues" },
  };
}

function manifest(name: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name, seampact: { role: "core" }, ...extra });
}

// Two published packages and an unpublished one, with the changesets access.
function releaseTree(
  published: Record<string, unknown>,
  binary: Record<string, unknown>,
  access: string,
  lint: Record<string, unknown> = published,
) {
  return writeTree({
    "packages/spec/package.json": manifest("@seampact/spec", {
      ...publicMetadata("packages/spec"),
      ...published,
    }),
    "packages/spec/README.md": "# @seampact/spec\n",
    "packages/lint/package.json": manifest("@seampact/lint", {
      ...publicMetadata("packages/lint"),
      ...lint,
    }),
    "packages/lint/README.md": "# @seampact/lint\n",
    "packages/binary/package.json": manifest("@seampact/binary", binary),
    ".changeset/config.json": JSON.stringify({ access }),
  });
}

// The small trees hold npm packages only: no other version field to stamp.
const NO_VERSION_FILES = () => [];

const violations = (root: string, published: readonly string[] = PUBLISHED) =>
  checkPackageRules(root, published, NO_VERSION_FILES).map(formatViolation);

// The repository's manifests, pack entries and changesets config, stamped as the release branch is.
function stampedRepositoryCopy(): string {
  const root = writeTree({});
  const copy = (file: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(REPO, file), join(root, file));
  };

  copy("package.json");

  // Every file the stamp writes, then the files the package rules read besides them.
  for (const edit of releaseVersionEdits(REPO, RELEASE)) copy(edit.file);

  for (const directory of packageDirectories(REPO)) {
    if (existsSync(join(REPO, directory, "README.md"))) copy(`${directory}/README.md`);

    const json = JSON.parse(readFileSync(join(REPO, directory, "package.json"), "utf8"));
    const packEntry: unknown = json.seampact?.pack;

    if (typeof packEntry === "string") copy(`${directory}/${packEntry}`);
  }

  for (const edit of releaseVersionEdits(root, RELEASE))
    writeFileSync(join(root, edit.file), edit.after);

  return root;
}

describe("package rules", () => {
  it("passes on the repository", () => {
    expect(checkPackageRules(REPO).map(formatViolation)).toEqual([]);
  });

  it("package roles", () => {
    proves("roles", "roles", "packages/spec/package.json", "exactly one `seampact.role`");
    proves("roles-unknown", "roles", "packages/spec/package.json", 'unknown role "wizard"');
  });

  it("dependency rule 1", () => {
    proves(
      "rule-1",
      "rule 1",
      "packages/compiler/package.json",
      "depends on @seampact/codegen-nestjs, a target",
    );
  });

  it("dependency rule 2", () => {
    proves("rule-2", "rule 2", "packages/codegen-fetch/package.json", "@seampact/codegen-zod");
    proves(
      "rule-2-peers",
      "rule 2",
      "packages/codegen-fetch/package.json",
      "@seampact/codegen-core as a peer",
    );
  });

  it("dependency rule 3", () => {
    proves("rule-3", "rule 3", "packages/hooks/package.json", "depends on nothing");
  });

  it("dependency rule 4", () => {
    proves("rule-4", "rule 4", "packages/signed-webhooks/package.json", "@seampact/spec, a core");
  });

  it("dependency rule 5", () => {
    proves(
      "rule-5",
      "rule 5",
      "packages/nestjs-casl/package.json",
      "@seampact/signed-webhooks, a helper",
    );
    proves("rule-5-peer", "rule 5", "packages/nestjs-casl/package.json", "library as a peer");
  });

  it("dependency rule 6", () => {
    proves("rule-6", "rule 6", "packages/pack-hal/package.json", "@seampact/spec, a core");
  });

  it("dependency rule 7", () => {
    proves("rule-7", "rule 7", "packages/spec/package.json", "tool @seampact/http-suite");
  });

  it("devDependencies add only core and tool packages", () => {
    proves(
      "dev-dependencies",
      "dev-dependencies",
      "packages/codegen-fetch/package.json",
      "@seampact/signed-webhooks is a helper",
    );
  });

  it("a pack names an existing YAML entry", () => {
    proves(
      "pack",
      "pack",
      "packages/pack-hal/package.json",
      'seampact.pack "pack.yaml" does not exist',
    );
    proves(
      "pack-entry-named",
      "pack",
      "packages/pack-hal/package.json",
      "names its YAML entry file",
    );
  });

  it("namespaces and no publish", () => {
    const fail = fixture("npm-namespace", "fail");

    expect(fixture("npm-namespace", "pass")).toEqual([]);
    expect(fail).toHaveLength(2);
    expect(fail.join("\n")).toContain('npm name "seampact-spec"');
    expect(fail.join("\n")).toContain("private: true");

    proves("changeset", "namespaces", ".changeset/config.json", '"restricted"');

    expect(fixture("workflow-publish", "pass")).toEqual([]);
    const wf = fixture("workflow-publish", "fail");

    expect(wf).toHaveLength(4);
    expect(wf[0]).toContain(".github/workflows/ci.yml: namespaces: line 5");
    expect(wf.join("\n")).toContain("Gradle publish");
    expect(wf.join("\n")).toContain("Maven deploy");
    expect(wf.join("\n")).toContain("line 8: publishes (Gradle publish)");

    proves("scripts-publish", "namespaces", "package.json", 'script "release" publishes');

    expect(fixture("gradle", "pass")).toEqual([]);
    // The pass fixture holds the plugin ids of the unpublished included build jvm/build-logic.
    const g = fixture("gradle", "fail");

    expect(g).toHaveLength(2);
    expect(g.join("\n")).toContain('Gradle group "com.acme" must be io.github.jubasse');
    expect(g.join("\n")).toContain('Gradle plugin id "com.acme.seampact"');

    proves("composer", "namespaces", "php/laravel/composer.json", 'Composer name "acme/laravel"');
  });

  it("a public package has repository, homepage, bugs and a README", () => {
    const fail = fixture("metadata", "fail");

    expect(fixture("metadata", "pass")).toEqual([]);
    expect(fail).toHaveLength(4);
    expect(fail.join("\n")).toContain("needs `repository`");
    expect(fail.join("\n")).toContain("needs a `homepage`");
    expect(fail.join("\n")).toContain("needs `bugs`");
    expect(fail.join("\n")).toContain("packages/spec/README.md: metadata: a public package");
    expect(fixture("metadata", "empty-readme").join("\n")).toContain(
      "packages/spec/README.md: metadata: a public package",
    );
  });

  it("checks a tree at 0.0.0 in the development form", () => {
    const development = releaseTree(
      { version: "0.0.0", private: true },
      { private: true },
      "restricted",
    );

    expect(violations(development)).toEqual([]);

    const publicPackages = releaseTree({ version: "0.0.0" }, {}, "restricted");

    expect(violations(publicPackages)).toEqual([
      "packages/binary/package.json: namespaces: manifest must be `private: true` until p8-release (A3, A27)",
      "packages/lint/package.json: namespaces: manifest must be `private: true` until p8-release (A3, A27)",
      "packages/spec/package.json: namespaces: manifest must be `private: true` until p8-release (A3, A27)",
    ]);
  });

  it("checks a stamped tree in the release form", () => {
    const stamped = releaseTree(
      { version: RELEASE },
      { version: RELEASE, private: true },
      "public",
    );

    expect(violations(stamped)).toEqual([]);

    const unstamped = releaseTree({ version: RELEASE, private: true }, {}, "restricted");

    expect(violations(unstamped)).toEqual([
      "packages/binary/package.json: namespaces: an unpublished package stays `private: true` in a stamped release",
      "packages/lint/package.json: namespaces: a published package has no `private` field in a stamped release: run scripts/release/stamp.ts",
      "packages/spec/package.json: namespaces: a published package has no `private` field in a stamped release: run scripts/release/stamp.ts",
      '.changeset/config.json: namespaces: `access` must be "public" in a stamped release: run scripts/release/stamp.ts',
      `packages/binary/package.json: namespaces: version is undefined in a release stamped at ${RELEASE}: run scripts/release/stamp.ts`,
    ]);
  });

  it("passes on a stamped copy of the repository", () => {
    expect(checkPackageRules(stampedRepositoryCopy()).map(formatViolation)).toEqual([]);
  });

  it("refuses a half-stamped copy of the repository, by file", () => {
    const halfStamped = stampedRepositoryCopy();
    const restored = [
      "packages/tools/binary/package.json",
      "packages/packs/pack-hal/pack.yaml",
      "packages/runtime/server-runtime/src/version.ts",
      "jvm/gradle.properties",
      "python/hooks/pyproject.toml",
    ];

    for (const file of restored) copyFileSync(join(REPO, file), join(halfStamped, file));

    const found = checkPackageRules(halfStamped).map(formatViolation);

    expect(found).toContain(
      `packages/tools/binary/package.json: namespaces: version is "0.0.0" in a release stamped at ${RELEASE}: run scripts/release/stamp.ts`,
    );
    expect(found).toContain(
      `packages/packs/pack-hal/pack.yaml: namespaces: pack.version is "0.0.0", not "${RELEASE}" in a stamped release: run scripts/release/stamp.ts`,
    );
    expect(found).toContain(
      `packages/runtime/server-runtime/src/version.ts: namespaces: SERVER_RUNTIME_VERSION is "0.0.0", not "${RELEASE}" in a stamped release: run scripts/release/stamp.ts`,
    );
    expect(found.some((v) => v.startsWith("jvm/gradle.properties: namespaces: "))).toBe(true);
    expect(found.some((v) => v.startsWith("python/hooks/pyproject.toml: namespaces: "))).toBe(true);
  });

  it("refuses a mixed tree by name", () => {
    const mixed = releaseTree({ version: RELEASE }, { private: true }, "public", {
      version: "0.0.0",
    });

    expect(violations(mixed)).toEqual([
      "package.json: namespaces: the published packages are not at one version (packages/lint at 0.0.0, packages/spec at 1.2.3): all at 0.0.0, or all stamped by scripts/release/stamp.ts",
    ]);

    const unreleased = releaseTree({ version: "1.0.0-rc.1" }, { private: true }, "public");

    expect(violations(unreleased)).toEqual([
      'packages/lint/package.json: namespaces: a published package is at 0.0.0 or at a release version MAJOR.MINOR.PATCH, not "1.0.0-rc.1"',
      'packages/spec/package.json: namespaces: a published package is at 0.0.0 or at a release version MAJOR.MINOR.PATCH, not "1.0.0-rc.1"',
    ]);
  });

  it("the release scripts publish only through the npm publish of publish-npm.ts", () => {
    const publishScript = join(REPO, "scripts/release/publish-npm.ts");
    const root = writeTree({});

    mkdirSync(join(root, "scripts/release"), { recursive: true });
    copyFileSync(publishScript, join(root, "scripts/release/publish-npm.ts"));

    expect(violations(root)).toEqual([]);

    // The same npm publish anywhere else in the release scripts is seen, in its spawned form too.
    copyFileSync(publishScript, join(root, "scripts/release/publish-again.ts"));

    const elsewhere = violations(root);

    expect(elsewhere).toContainEqual(
      expect.stringMatching(
        /^scripts\/release\/publish-again\.ts: namespaces: line \d+: publishes \(a `publish` argument of a spawned command\); only scripts\/release\/publish-npm\.ts publishes/,
      ),
    );
    expect(elsewhere.every((v) => v.startsWith("scripts/release/publish-again.ts: "))).toBe(true);

    // The publish script may run the npm publish only.
    const gradle = writeTree({ "scripts/release/publish-npm.ts": 'run("./gradlew publish");\n' });

    expect(violations(gradle)).toEqual([
      "scripts/release/publish-npm.ts: namespaces: line 1: publishes (Gradle publish); only scripts/release/publish-npm.ts publishes, to npm (A3)",
    ]);
  });

  it("cli exits non-zero on a violation", () => {
    const run = (root: string) =>
      execFileSync("node", [join(HERE, "cli.ts"), root], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });

    expect(() => run(join(HERE, "fixtures/roles/pass"))).not.toThrow();
    expect(() => run(join(HERE, "fixtures/roles/fail"))).toThrow();
  });
});
