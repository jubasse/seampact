import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPackageRules, formatViolation } from "./rules.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const fixture = (name: string, side: "pass" | "fail") =>
  checkPackageRules(join(HERE, "fixtures", name, side)).map(formatViolation);

/** A case passes in `pass` and, in `fail`, yields exactly the expected rule and message parts. */
function proves(name: string, rule: string, file: string, ...parts: string[]) {
  expect(fixture(name, "pass"), `${name}/pass`).toEqual([]);
  const out = fixture(name, "fail");

  expect(out, `${name}/fail`).toHaveLength(1);
  expect(out[0]).toContain(`${file}: ${rule}: `);

  for (const p of parts) expect(out[0]).toContain(p);
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
    const g = fixture("gradle", "fail");

    expect(g).toHaveLength(2);
    expect(g.join("\n")).toContain('Gradle group "com.acme" must be io.github.jubasse');
    expect(g.join("\n")).toContain('Gradle plugin id "com.acme.seampact"');

    proves("composer", "namespaces", "php/laravel/composer.json", 'Composer name "acme/laravel"');
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
