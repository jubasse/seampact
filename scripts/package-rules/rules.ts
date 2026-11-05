// Package roles, the dependency rules of ADR 0009 and the namespaces of A27, checked over
// the manifests of a repository: npm (packages/*), Gradle (jvm/**) and Composer (php/*).
//
// Two modes: development, where every npm package is private and the changesets access restricted (A3), and release,
// set by release.yml on a stamped checkout only, where the published packages drop `private` and the access is public.
//
// Deferred: package roles and dependency rules for Gradle (jvm/**) and Composer (php/*)
// manifests. ADR 0009 states them for npm only and no role metadata convention exists for those
// ecosystems yet; today only their namespaces (A27) are checked. Add the role rules here once
// the convention is decided.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { packageDirectories } from "../workspace/index.ts";

export interface Violation {
  /** Repository-relative path of the manifest or file at fault. */
  file: string;
  /** "roles", "rule 1" to "rule 7", "dev-dependencies", "pack", "namespaces" or "metadata". */
  rule: string;
  message: string;
}

export const ROLES = ["core", "target", "hooks", "helper", "adapter", "pack", "tool"] as const;
type Role = (typeof ROLES)[number];

const SCOPE = "@seampact/";
const GRADLE_GROUP = "io.github.jubasse";
const GRADLE_PLUGIN_ID = "io.github.jubasse.seampact";
// An included build of precompiled convention plugins: its plugin ids are never published.
const GRADLE_INTERNAL_BUILD_PREFIX = "jvm/build-logic/";
const COMPOSER_VENDOR = "seampact";
const REPOSITORY_URL = "git+https://github.com/jubasse/seampact.git";
const ISSUES_URL = "https://github.com/jubasse/seampact/issues";
const DOCS_SITE_URL = "https://jubasse.github.io/seampact/";
// The two packages that are never published; every other npm package is public.
const UNPUBLISHED_PACKAGES = ["@seampact/binary", "@seampact/docs-site"];
const RUNTIME_SETS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/** The development form (A3), or the stamped form of a release, with the directories of the published packages. */
export type PackageRulesMode =
  | { readonly kind: "development" }
  | { readonly kind: "release"; readonly publishedPackages: readonly string[] };

export const DEVELOPMENT_MODE: PackageRulesMode = { kind: "development" };

const RELEASE_SCRIPTS_DIR = "scripts/release";
// The one release script that publishes, and what it may run: the idempotent npm publish of release.yml.
const RELEASE_PUBLISH_SCRIPT = "scripts/release/publish-npm.ts";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

interface Npm {
  file: string;
  dir: string;
  name: string;
  role: Role | undefined;
  json: Rec;
}

function readJson(root: string, file: string, out: Violation[], rule: string): Rec | undefined {
  try {
    const v: unknown = JSON.parse(readFileSync(join(root, file), "utf8"));

    if (isRec(v)) return v;
    out.push({ file, rule, message: "manifest is not a JSON object" });
  } catch (e) {
    out.push({ file, rule, message: `manifest is not valid JSON: ${(e as Error).message}` });
  }

  return undefined;
}

function depNames(json: Rec, set: string): string[] {
  const v = json[set];

  return isRec(v) ? Object.keys(v) : [];
}

function listDirs(root: string, rel: string): string[] {
  const abs = join(root, rel);

  if (!existsSync(abs)) return [];

  return readdirSync(abs)
    .filter((n) => statSync(join(abs, n)).isDirectory())
    .sort();
}

function walk(root: string, rel: string, match: (name: string) => boolean): string[] {
  const abs = join(root, rel);

  if (!existsSync(abs)) return [];
  const out: string[] = [];

  for (const name of readdirSync(abs).sort()) {
    if (name === "node_modules" || name === "build" || name.startsWith(".")) continue;
    const child = posix.join(rel, name);

    if (statSync(join(root, child)).isDirectory()) out.push(...walk(root, child, match));
    else if (match(name)) out.push(child);
  }

  return out;
}

function loadNpm(root: string, out: Violation[]): Npm[] {
  const pkgs: Npm[] = [];

  for (const dir of packageDirectories(root)) {
    const file = `${dir}/package.json`;
    const json = readJson(root, file, out, "roles");

    if (!json) continue;
    const role = checkRole(file, json, out);

    pkgs.push({ file, dir, name: String(json.name ?? ""), role, json });
  }

  return pkgs;
}

function checkRole(file: string, json: Rec, out: Violation[]): Role | undefined {
  const seampact = json.seampact;
  const role = isRec(seampact) ? seampact.role : undefined;

  if (typeof role !== "string") {
    out.push({
      file,
      rule: "roles",
      message: `needs exactly one \`seampact.role\` string, one of ${ROLES.join(", ")}`,
    });

    return undefined;
  }

  if (!(ROLES as readonly string[]).includes(role)) {
    out.push({
      file,
      rule: "roles",
      message: `unknown role "${role}" (one of ${ROLES.join(", ")})`,
    });

    return undefined;
  }

  return role as Role;
}

function checkDependencies(pkgs: Npm[], out: Violation[]): void {
  const roleOf = new Map<string, Role | undefined>(pkgs.map((p) => [p.name, p.role]));

  for (const p of pkgs) {
    if (!p.role) continue;
    const add = (rule: string, message: string) => out.push({ file: p.file, rule, message });
    const ours = (set: string) => depNames(p.json, set).filter((n) => n.startsWith(SCOPE));

    for (const set of [...RUNTIME_SETS, "devDependencies"] as const) {
      for (const dep of ours(set)) {
        if (!roleOf.has(dep)) add("roles", `${set}: ${dep} is not a package of this repository`);
      }
    }

    // Rule 7: no product package depends on a tool (a tool may depend on anything).
    for (const set of RUNTIME_SETS)
      for (const dep of ours(set))
        if (roleOf.get(dep) === "tool" && p.role !== "tool")
          add(
            "rule 7",
            `${p.role} package depends on the tool ${dep} (${set}); no product package may`,
          );

    const seen = (set: string) =>
      ours(set).filter((d) => roleOf.get(d) !== "tool" || p.role === "tool");
    const only = (rule: string, label: string, allowed: (dep: string) => boolean) => {
      for (const set of RUNTIME_SETS)
        for (const dep of seen(set))
          if (roleOf.has(dep) && !allowed(dep))
            add(
              rule,
              `${p.role} package depends on ${dep}, a ${roleOf.get(dep)} (${set}); ${label}`,
            );
    };

    const roleIs =
      (...roles: Role[]) =>
      (dep: string) =>
        roles.includes(roleOf.get(dep) as Role);

    switch (p.role) {
      case "core":
        only("rule 1", "a core package depends only on core packages", roleIs("core"));
        break;
      case "target": {
        const required = [`${SCOPE}codegen-core`, `${SCOPE}spec`];

        for (const dep of required)
          if (!depNames(p.json, "peerDependencies").includes(dep))
            add(
              "rule 2",
              `a target has ${dep} as a peer dependency, so it binds to the CLI's copy`,
            );

        for (const set of RUNTIME_SETS)
          for (const dep of seen(set))
            if (!(set === "peerDependencies" && required.includes(dep)))
              add(
                "rule 2",
                `target depends on ${dep} (${set}); only codegen-core and spec, as peers`,
              );
        break;
      }

      case "hooks":
        for (const set of RUNTIME_SETS)
          for (const dep of depNames(p.json, set))
            add("rule 3", `hooks depends on nothing, but lists ${dep} (${set})`);
        break;
      case "helper":
        only("rule 4", "a helper depends on hooks and third-party libraries only", roleIs("hooks"));
        break;
      case "adapter":
        only(
          "rule 5",
          "an adapter depends on hooks and has its library as a peer",
          roleIs("hooks"),
        );

        if (!depNames(p.json, "peerDependencies").some((d) => !d.startsWith(SCOPE)))
          add("rule 5", "an adapter has its library as a peer dependency, and none is listed");
        break;
      case "pack":
        only("rule 6", "a pack depends only on the packs it extends", roleIs("pack"));
        break;
      case "tool":
        break;
    }

    // devDependencies may add only core and tool packages.
    if (p.role !== "tool")
      for (const dep of ours("devDependencies")) {
        const r = roleOf.get(dep);

        if (r && r !== "core" && r !== "tool")
          add(
            "dev-dependencies",
            `devDependencies may add only core and tool packages; ${dep} is a ${r}`,
          );
      }
  }
}

function checkPacks(root: string, pkgs: Npm[], out: Violation[]): void {
  for (const p of pkgs) {
    if (p.role !== "pack") continue;
    const entry = isRec(p.json.seampact) ? p.json.seampact.pack : undefined;
    const add = (message: string) => out.push({ file: p.file, rule: "pack", message });

    if (typeof entry !== "string" || !/\.ya?ml$/.test(entry))
      add("a pack names its YAML entry file in `seampact.pack`");
    else if (entry.startsWith("/") || entry.split("/").includes(".."))
      add(`seampact.pack "${entry}" must stay inside the package`);
    else if (!existsSync(join(root, p.dir, entry)))
      add(`seampact.pack "${entry}" does not exist in ${p.dir}`);
  }
}

function checkNpmNamespace(pkgs: Npm[], mode: PackageRulesMode, out: Violation[]): void {
  for (const p of pkgs) {
    const add = (message: string) => out.push({ file: p.file, rule: "namespaces", message });

    if (!/^@seampact\/[a-z0-9][a-z0-9-]*$/.test(p.name))
      add(`npm name "${p.name}" must be @seampact/<name> (A27)`);

    const message = privateFieldProblem(p, mode);

    if (message) add(message);
  }
}

function checkPublicMetadata(root: string, pkgs: Npm[], out: Violation[]): void {
  for (const p of pkgs) {
    if (UNPUBLISHED_PACKAGES.includes(p.name)) continue;
    const add = (message: string) => out.push({ file: p.file, rule: "metadata", message });
    const { repository, homepage, bugs } = p.json;

    if (
      !isRec(repository) ||
      repository.type !== "git" ||
      repository.url !== REPOSITORY_URL ||
      repository.directory !== p.dir
    )
      add(`needs \`repository\` {type: "git", url: "${REPOSITORY_URL}", directory: "${p.dir}"}`);

    if (typeof homepage !== "string" || !homepage.startsWith(DOCS_SITE_URL))
      add(`needs a \`homepage\` on the docs site, ${DOCS_SITE_URL}`);

    if (!isRec(bugs) || bugs.url !== ISSUES_URL) add(`needs \`bugs\` {url: "${ISSUES_URL}"}`);

    if (!hasReadme(join(root, p.dir, "README.md")))
      out.push({
        file: `${p.dir}/README.md`,
        rule: "metadata",
        message: "a public package needs a README.md that is not empty",
      });
  }
}

function privateFieldProblem(p: Npm, mode: PackageRulesMode): string | undefined {
  if (mode.kind === "development")
    return p.json.private === true
      ? undefined
      : "manifest must be `private: true` until p8-release (A3, A27)";

  if (!mode.publishedPackages.includes(p.dir))
    return p.json.private === true
      ? undefined
      : "an unpublished package stays `private: true` in a release";

  return "private" in p.json
    ? "a published package has no `private` field in a release: run scripts/release/stamp.ts"
    : undefined;
}

function checkChangesets(root: string, mode: PackageRulesMode, out: Violation[]): void {
  const file = ".changeset/config.json";

  if (!existsSync(join(root, file))) return;
  const json = readJson(root, file, out, "namespaces");
  const expected = mode.kind === "development" ? "restricted" : "public";

  if (!json || json.access === expected) return;

  out.push({
    file,
    rule: "namespaces",
    message:
      mode.kind === "development"
        ? '`access` must stay "restricted" until p8-release'
        : '`access` is "public" in a release: run scripts/release/stamp.ts',
  });
}

const NPM_PUBLISH = "npm publish";
const SPAWNED_PUBLISH = "a `publish` argument of a spawned command";
const CHANGESETS_ACTION_PUBLISH: [RegExp, string] = [
  /^\s*publish\s*:/,
  "a changesets/action `publish:` input",
];

const PUBLISH: [RegExp, string][] = [
  [/\b(?:npm|pnpm|yarn)\s+(?:[\w-]+\s+)*publish\b/, NPM_PUBLISH],
  [/\bchangeset\s+publish\b/, "changeset publish"],
  CHANGESETS_ACTION_PUBLISH,
  // `publishToMavenLocal` only writes the local `~/.m2` cache the consumer builds read; it reaches no registry.
  [/\bgradlew?\s+.*\bpublish(?!ToMavenLocal\b)\w*/, "Gradle publish"],
  [/\bmvnw?\s+.*\bdeploy\b/, "Maven deploy"],
  [/\bcomposer\s+.*\b(?:publish|deploy)\b/, "Composer publish"],
];

function publishes(code: string): string | undefined {
  return PUBLISH.find(([re]) => re.test(code))?.[1];
}

// A script spawns a publish as an argument list (`spawnSync(npm, ["publish", ...])`); a `publish:` key there is
// configuration (the registry's permissions), not the changesets action input of a workflow.
const RELEASE_SCRIPT_PUBLISH: [RegExp, string][] = [
  ...PUBLISH.filter((pattern) => pattern !== CHANGESETS_ACTION_PUBLISH),
  [/["'`]publish["'`]/, SPAWNED_PUBLISH],
];

/** Every file of `scripts/release`: only the npm publish of the publish script is accepted, where release.yml runs it. */
function checkReleaseScripts(root: string, out: Violation[]): void {
  for (const file of walk(root, RELEASE_SCRIPTS_DIR, () => true)) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");

    lines.forEach((code, index) => {
      for (const [re, what] of RELEASE_SCRIPT_PUBLISH) {
        if (!re.test(code) || isAcceptedReleasePublish(file, what)) continue;

        out.push({
          file,
          rule: "namespaces",
          message: `line ${index + 1}: publishes (${what}); only ${RELEASE_PUBLISH_SCRIPT} publishes, to npm (A3)`,
        });
      }
    });
  }
}

function isAcceptedReleasePublish(file: string, what: string): boolean {
  return file === RELEASE_PUBLISH_SCRIPT && (what === NPM_PUBLISH || what === SPAWNED_PUBLISH);
}

/** `scripts` of the root and every npm manifest: a publish command there is as bad as in CI. */
function checkScripts(root: string, pkgs: Npm[], out: Violation[]): void {
  const manifests: [string, Rec | undefined][] = [
    [
      "package.json",
      existsSync(join(root, "package.json"))
        ? readJson(root, "package.json", out, "namespaces")
        : undefined,
    ],
    ...pkgs.map((p): [string, Rec] => [p.file, p.json]),
  ];

  for (const [file, json] of manifests) {
    const scripts = json?.scripts;

    if (!isRec(scripts)) continue;

    for (const [name, cmd] of Object.entries(scripts)) {
      const what = typeof cmd === "string" ? publishes(cmd) : undefined;

      if (what)
        out.push({
          file,
          rule: "namespaces",
          message: `script "${name}" publishes (${what}); nothing publishes before 1.0 (A3)`,
        });
    }
  }
}

function checkWorkflows(root: string, out: Violation[]): void {
  const dir = ".github/workflows";

  for (const name of readdirSyncSafe(root, dir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const file = `${dir}/${name}`;

    for (const { line, code } of workflowCommands(readFileSync(join(root, file), "utf8")))
      for (const [re, what] of PUBLISH)
        if (re.test(code))
          out.push({
            file,
            rule: "namespaces",
            message: `line ${line}: publishes (${what}); nothing publishes before 1.0 (A3)`,
          });
  }
}

const BLOCK_RUN = /^(\s*)(?:-\s+)?run:\s*[>|][+-]?\d*\s*$/;

const indentOf = (text: string): number => text.length - text.trimStart().length;

/**
 * The workflow's commands with the line each starts on. A folded or literal `run:` block and a command continued
 * with a trailing backslash are one command, so a publish on a continuation line is read with its gradlew or mvn.
 */
function workflowCommands(text: string): { line: number; code: string }[] {
  const lines = text.split("\n").map((raw) => raw.replace(/(^|\s)#.*$/, ""));
  const commands: { line: number; code: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const start = i + 1;
    const block = BLOCK_RUN.exec(lines[i] ?? "");
    let code = lines[i] ?? "";

    if (block) {
      const base = (block[1] ?? "").length;

      while (
        i + 1 < lines.length &&
        (lines[i + 1]?.trim() === "" || indentOf(lines[i + 1] ?? "") > base)
      )
        code += ` ${lines[++i]}`;
    } else {
      while (code.trimEnd().endsWith("\\") && i + 1 < lines.length)
        code = `${code.trimEnd().slice(0, -1)} ${lines[++i]}`;
    }

    commands.push({ line: start, code });
  }

  return commands;
}

function readdirSyncSafe(root: string, rel: string): string[] {
  return existsSync(join(root, rel)) ? readdirSync(join(root, rel)).sort() : [];
}

function checkGradle(root: string, out: Violation[]): void {
  for (const file of walk(root, "jvm", (n) => n === "build.gradle" || n === "build.gradle.kts")) {
    const text = readFileSync(join(root, file), "utf8");
    const add = (message: string) => out.push({ file, rule: "namespaces", message });

    for (const m of text.matchAll(/^\s*group\s*=\s*["']([^"']+)["']/gm))
      if (m[1] !== GRADLE_GROUP) add(`Gradle group "${m[1]}" must be ${GRADLE_GROUP} (A27)`);

    if (file.startsWith(GRADLE_INTERNAL_BUILD_PREFIX)) continue;

    for (const m of text.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
      const id = m[1] as string;

      if (id !== GRADLE_PLUGIN_ID && !id.startsWith(`${GRADLE_PLUGIN_ID}.`))
        add(`Gradle plugin id "${id}" must be ${GRADLE_PLUGIN_ID} (A27)`);
    }
  }
}

function checkComposer(root: string, out: Violation[]): void {
  for (const d of listDirs(root, "php")) {
    const file = `php/${d}/composer.json`;

    if (!existsSync(join(root, file))) continue;
    const json = readJson(root, file, out, "namespaces");

    if (!json) continue;
    const name = json.name;

    if (typeof name !== "string" || !name.startsWith(`${COMPOSER_VENDOR}/`))
      out.push({
        file,
        rule: "namespaces",
        message: `Composer name "${String(name)}" must be ${COMPOSER_VENDOR}/<name> (A27)`,
      });
  }
}

export function checkPackageRules(
  root: string,
  mode: PackageRulesMode = DEVELOPMENT_MODE,
): Violation[] {
  const out: Violation[] = [];
  const pkgs = loadNpm(root, out);

  checkDependencies(pkgs, out);
  checkPacks(root, pkgs, out);
  checkPublicMetadata(root, pkgs, out);
  checkNpmNamespace(pkgs, mode, out);
  checkChangesets(root, mode, out);
  checkWorkflows(root, out);
  checkScripts(root, pkgs, out);
  checkReleaseScripts(root, out);
  checkGradle(root, out);
  checkComposer(root, out);

  return out;
}

export function formatViolation(v: Violation): string {
  return `${v.file}: ${v.rule}: ${v.message}`;
}

function hasReadme(readmePath: string): boolean {
  return existsSync(readmePath) && readFileSync(readmePath, "utf8").trim() !== "";
}
