import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundleLayoutProblems } from "./bundle-layout.ts";
import { bundleManifest, checkBundleAgainstManifest, repositoryFiles } from "./bundle-manifest.ts";
import { bundleSignatureProblems, signBundle } from "./bundle-signatures.ts";
import {
  COMPILER_MODULE,
  type Coordinate,
  DOCS_URL,
  type ExpectedBundle,
  expectedBundle,
  JVM_GROUP,
  versionDirectory,
} from "./jvm-release.ts";
import { rebuiltPluginProblems } from "./plugin-portal-plan.ts";

const VERSION = "1.2.3";
const REPOSITORY_ROOT = join(import.meta.dirname, "../../..");
const LIBRARY: Coordinate = { group: JVM_GROUP, artifactId: "seampact-hooks" };
const COMPILER: Coordinate = { group: JVM_GROUP, artifactId: COMPILER_MODULE };
const ASSET = "seampact-linux-x64";
const CLASSIFIER = "linux-x86_64";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const temporaryDirectory = (prefix: string) => {
  const directory = mkdtempSync(join(tmpdir(), prefix));

  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

  return directory;
};

const digest = (algorithm: string, bytes: string) =>
  createHash(algorithm).update(bytes).digest("hex");

function writeFile(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const pom = (coordinate: Coordinate, scm = true) =>
  [
    "<project>",
    `  <groupId>${coordinate.group}</groupId>`,
    `  <artifactId>${coordinate.artifactId}</artifactId>`,
    `  <version>${VERSION}</version>`,
    `  <name>${coordinate.artifactId}</name>`,
    "  <description>A seampact module.</description>",
    `  <url>${DOCS_URL}</url>`,
    "  <licenses><license><name>MIT License</name><url>https://opensource.org/license/mit</url></license></licenses>",
    "  <developers><developer><id>jubasse</id><name>Julien Metral</name></developer></developers>",
    scm
      ? "  <scm><connection>scm:git:https://github.com/jubasse/seampact.git</connection><url>https://github.com/jubasse/seampact</url></scm>"
      : "",
    "</project>",
  ].join("\n");

// Writes the file with its MD5 and SHA-1, and a placeholder signature the layout check only looks for.
function writeStaged(
  repository: string,
  coordinate: Coordinate,
  fileName: string,
  text: string,
): void {
  const file = join(repository, versionDirectory(coordinate, VERSION), fileName);

  writeFile(file, text);
  writeFile(`${file}.md5`, digest("md5", text));
  writeFile(`${file}.sha1`, digest("sha1", text));
  writeFile(`${file}.asc`, "signature");
}

function stagedBundle(): string {
  const repository = temporaryDirectory("jvm-bundle-");
  const base = `${LIBRARY.artifactId}-${VERSION}`;

  writeStaged(repository, LIBRARY, `${base}.pom`, pom(LIBRARY));
  writeStaged(repository, LIBRARY, `${base}.jar`, "classes");
  writeStaged(repository, LIBRARY, `${base}-sources.jar`, "sources");
  writeStaged(repository, LIBRARY, `${base}-javadoc.jar`, "javadoc");
  writeStaged(repository, COMPILER, `${COMPILER_MODULE}-${VERSION}.pom`, pom(COMPILER));
  writeStaged(repository, COMPILER, `${COMPILER_MODULE}-${VERSION}-${CLASSIFIER}.exe`, "binary");

  return repository;
}

const expected: ExpectedBundle = {
  version: VERSION,
  coordinates: [LIBRARY, COMPILER],
  compilerClassifiers: new Map([[ASSET, CLASSIFIER]]),
};
const releaseSums = new Map([[ASSET, digest("sha256", "binary")]]);
const layoutProblems = (repository: string, signatures: "signed" | "unsigned" = "signed") =>
  bundleLayoutProblems(repository, repositoryFiles(repository), expected, releaseSums, signatures);
const unsignedBundle = () => {
  const repository = stagedBundle();

  for (const path of repositoryFiles(repository).filter((file) => file.endsWith(".asc")))
    rmSync(join(repository, path));

  return repository;
};

const libraryFile = (repository: string, fileName: string) =>
  join(repository, versionDirectory(LIBRARY, VERSION), fileName);

describe("the bundle manifest", () => {
  it("lists every file with its hash, and accepts the directory it was written from", () => {
    const repository = stagedBundle();
    const manifest = bundleManifest(repository);

    expect(manifest).toContainEqual({
      path: `io/github/jubasse/seampact-hooks/${VERSION}/seampact-hooks-${VERSION}.jar`,
      sha256: digest("sha256", "classes"),
    });
    expect(() => checkBundleAgainstManifest(repository, manifest)).not.toThrow();
  });

  it("refuses a file it does not list, a file it lists that is missing, and changed bytes, naming each", () => {
    const repository = stagedBundle();
    const manifest = bundleManifest(repository);

    writeFile(join(repository, "extra.jar"), "extra");
    rmSync(libraryFile(repository, `seampact-hooks-${VERSION}-sources.jar`));
    writeFile(libraryFile(repository, `seampact-hooks-${VERSION}.jar`), "replaced");

    expect(() => checkBundleAgainstManifest(repository, manifest)).toThrow(
      /extra\.jar is in the artefact, but not in the manifest[\s\S]*sources\.jar is in the manifest, but not in the artefact[\s\S]*hooks-1\.2\.3\.jar hashes/,
    );
  });
});

describe("the bundle layout check", () => {
  it("accepts a bundle with every file Central requires", () => {
    expect(layoutProblems(stagedBundle())).toEqual([]);
  });

  it("names a missing sources jar, signature and scm, a wrong MD5 and a stray file", () => {
    const repository = stagedBundle();

    rmSync(libraryFile(repository, `seampact-hooks-${VERSION}-sources.jar`));
    rmSync(libraryFile(repository, `seampact-hooks-${VERSION}-sources.jar.md5`));
    rmSync(libraryFile(repository, `seampact-hooks-${VERSION}-sources.jar.sha1`));
    rmSync(libraryFile(repository, `seampact-hooks-${VERSION}-sources.jar.asc`));
    rmSync(libraryFile(repository, `seampact-hooks-${VERSION}-javadoc.jar.asc`));
    writeFile(libraryFile(repository, `seampact-hooks-${VERSION}.jar.md5`), "0");
    writeStaged(repository, LIBRARY, `seampact-hooks-${VERSION}.pom`, pom(LIBRARY, false));
    writeFile(join(repository, "io/github/jubasse/seampact-hooks/maven-metadata.xml"), "metadata");

    const problems = layoutProblems(repository);

    expect(problems).toContain(
      `io/github/jubasse/seampact-hooks/maven-metadata.xml is no file of an expected artefact at ${VERSION}`,
    );
    expect(problems.join("\n")).toMatch(/has a jar but no seampact-hooks-1\.2\.3-sources\.jar/);
    expect(problems.join("\n")).toMatch(/javadoc\.jar has no signature/);
    expect(problems.join("\n")).toMatch(/hooks-1\.2\.3\.jar\.md5 says 0/);
    expect(problems.join("\n")).toMatch(/hooks-1\.2\.3\.pom has no scm connection/);
  });

  it("names a compiler binary whose hash differs from SHA256SUMS, and a missing artefact", () => {
    const repository = stagedBundle();

    writeStaged(
      repository,
      COMPILER,
      `${COMPILER_MODULE}-${VERSION}-${CLASSIFIER}.exe`,
      "other binary",
    );
    rmSync(join(repository, versionDirectory(LIBRARY, VERSION)), { recursive: true });

    const problems = layoutProblems(repository).join("\n");

    expect(problems).toMatch(
      new RegExp(
        `${CLASSIFIER}\\.exe hashes [0-9a-f]{64}, but SHA256SUMS lists ${releaseSums.get(ASSET)} for ${ASSET}`,
      ),
    );
    expect(problems).toMatch(
      /io\.github\.jubasse:seampact-hooks:1\.2\.3 has no file in the bundle/,
    );
  });
});

describe("the unsigned bundle build-jvm stages", () => {
  it("passes without signatures and names a file signed already", () => {
    const repository = unsignedBundle();

    expect(layoutProblems(repository, "unsigned")).toEqual([]);

    writeFile(libraryFile(repository, `seampact-hooks-${VERSION}.jar.asc`), "signature");

    expect(layoutProblems(repository, "unsigned")).toEqual([
      `io/github/jubasse/seampact-hooks/${VERSION}/seampact-hooks-${VERSION}.jar is signed already: build-jvm stages unsigned bundles, which publish-maven-central signs`,
    ]);
  });
});

describe("the expected JVM release", () => {
  it("publishes every module but the Gradle plugin to Central, with the compiler's five classifiers", () => {
    const central = expectedBundle(REPOSITORY_ROOT, "central", VERSION);

    expect(central.coordinates.map((coordinate) => coordinate.artifactId).sort()).toEqual([
      "seampact-compiler",
      "seampact-hooks",
      "seampact-ir",
      "seampact-maven-plugin",
      "seampact-runner",
      "seampact-signed-webhooks",
      "seampact-spring-boot",
      "seampact-spring-runtime",
    ]);
    expect(central.compilerClassifiers.get("seampact-win32-x64.exe")).toBe("windows-x86_64");
    expect(central.compilerClassifiers.size).toBe(5);
  });
});

describe("the bundle signature check", () => {
  it("accepts good signatures by the key and names a file whose bytes changed after signing", () => {
    const home = temporaryDirectory("jvm-gpg-");
    const gpg = (...gpgArguments: string[]) =>
      execFileSync("gpg", ["--homedir", home, "--batch", "--quiet", ...gpgArguments], {
        encoding: "utf8",
      });
    const repository = temporaryDirectory("jvm-signed-");
    const file = libraryFile(repository, `seampact-hooks-${VERSION}.jar`);
    const keyFile = join(home, "public.asc");

    gpg(
      "--passphrase",
      "",
      "--quick-gen-key",
      "seampact test <test@invalid>",
      "ed25519",
      "sign",
      "1d",
    );
    writeFileSync(keyFile, gpg("--armor", "--export"));
    writeFile(file, "classes");
    gpg("--armor", "--detach-sign", "--output", `${file}.asc`, file);

    const files = repositoryFiles(repository);

    expect(bundleSignatureProblems(repository, files, keyFile)).toEqual([]);

    writeFileSync(file, "replaced");

    expect(bundleSignatureProblems(repository, files, keyFile)).toEqual([
      `io/github/jubasse/seampact-hooks/${VERSION}/seampact-hooks-${VERSION}.jar.asc is no good signature of its file by the release key`,
    ]);
  });
});

describe("the bundle signing", () => {
  const passphrase = "release passphrase";

  // A throwaway key with a passphrase, as the release key has; returns its secret and its public part.
  function releaseKey(): { secretKey: string; publicKeyFile: string } {
    const home = temporaryDirectory("jvm-key-");
    const gpg = (...gpgArguments: string[]) =>
      execFileSync(
        "gpg",
        ["--homedir", home, "--batch", "--quiet", "--pinentry-mode", "loopback", ...gpgArguments],
        { encoding: "utf8" },
      );
    const publicKeyFile = join(home, "public.asc");

    gpg(
      "--passphrase",
      passphrase,
      "--quick-gen-key",
      "seampact test <test@invalid>",
      "ed25519",
      "sign",
      "1d",
    );
    writeFileSync(publicKeyFile, gpg("--armor", "--export"));

    return {
      secretKey: gpg("--passphrase", passphrase, "--armor", "--export-secret-keys"),
      publicKeyFile,
    };
  }

  it("signs every file but the digests, so the bundle passes the signed check, and lists the signatures", () => {
    const { secretKey, publicKeyFile } = releaseKey();
    const repository = unsignedBundle();
    const manifest = bundleManifest(repository);
    const signedManifest = signBundle(repository, manifest, { secretKey, passphrase });
    const files = repositoryFiles(repository);

    expect(layoutProblems(repository, "signed")).toEqual([]);
    expect(bundleSignatureProblems(repository, files, publicKeyFile)).toEqual([]);
    expect(files.filter((file) => file.endsWith(".md5.asc") || file.endsWith(".sha1.asc"))).toEqual(
      [],
    );
    expect(signedManifest).toEqual(bundleManifest(repository));
    expect(signedManifest.length - manifest.length).toBe(6);
  });

  it("refuses a bundle whose bytes differ from the manifest, and a wrong passphrase, signing nothing", () => {
    const { secretKey } = releaseKey();
    const repository = unsignedBundle();
    const manifest = bundleManifest(repository);

    writeFileSync(libraryFile(repository, `seampact-hooks-${VERSION}.jar`), "replaced");

    expect(() => signBundle(repository, manifest, { secretKey, passphrase })).toThrow(
      /hooks-1\.2\.3\.jar hashes [0-9a-f]{64}, not the [0-9a-f]{64} build-jvm wrote/,
    );

    writeFileSync(libraryFile(repository, `seampact-hooks-${VERSION}.jar`), "classes");

    expect(() => signBundle(repository, manifest, { secretKey, passphrase: "wrong" })).toThrow(
      /could not be signed/,
    );
    expect(repositoryFiles(repository).filter((file) => file.endsWith(".asc"))).toEqual([]);
  });
});

describe("the rebuilt Gradle plugin check", () => {
  it("accepts outputs equal to the manifest and names one that differs", () => {
    const root = temporaryDirectory("jvm-root-");
    const build = join(root, "jvm/seampact-gradle-plugin/build");
    const plugin = `io/github/jubasse/seampact-gradle-plugin/${VERSION}/seampact-gradle-plugin-${VERSION}`;
    const marker = `io/github/jubasse/seampact/io.github.jubasse.seampact.gradle.plugin/${VERSION}/io.github.jubasse.seampact.gradle.plugin-${VERSION}.pom`;
    const outputs: [string, string][] = [
      [`${plugin}.jar`, `libs/seampact-gradle-plugin-${VERSION}.jar`],
      [`${plugin}-sources.jar`, `libs/seampact-gradle-plugin-${VERSION}-sources.jar`],
      [`${plugin}-javadoc.jar`, `libs/seampact-gradle-plugin-${VERSION}-javadoc.jar`],
      [`${plugin}.pom`, "publications/pluginMaven/pom-default.xml"],
      [`${plugin}.module`, "publications/pluginMaven/module.json"],
      [marker, "publications/seampactPluginMarkerMaven/pom-default.xml"],
    ];

    writeFile(
      join(root, "jvm/settings.gradle.kts"),
      'include("seampact-compiler")\ninclude("seampact-gradle-plugin")\n',
    );

    for (const [, output] of outputs) writeFile(join(build, output), output);

    const manifest = [
      ...outputs.map(([path, output]) => ({ path, sha256: digest("sha256", output) })),
      { path: `${plugin}.jar.asc`, sha256: digest("sha256", "signature") },
    ];

    expect(rebuiltPluginProblems(root, VERSION, manifest)).toEqual([]);

    writeFile(join(build, `libs/seampact-gradle-plugin-${VERSION}.jar`), "rebuilt");

    expect(rebuiltPluginProblems(root, VERSION, manifest)).toEqual([
      `${join(build, `libs/seampact-gradle-plugin-${VERSION}.jar`)} differs from the ${plugin}.jar build-jvm checked: the build is not reproducible`,
    ]);
  });
});
