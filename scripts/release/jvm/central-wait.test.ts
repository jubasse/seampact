import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seampactDependencies, waitForCentralModules } from "./central-wait.ts";
import { JVM_GROUP } from "./jvm-release.ts";
import { startLocalPortal } from "./local-portal.ts";

const VERSION = "1.2.3";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const pom = (...dependencies: [group: string, artifactId: string, version: string][]) =>
  [
    "<project>",
    "  <dependencyManagement><dependencies><dependency><groupId>io.github.jubasse</groupId><artifactId>seampact-bom</artifactId><version>0.0.1</version></dependency></dependencies></dependencyManagement>",
    "  <dependencies>",
    ...dependencies.map(
      ([group, artifactId, version]) =>
        `    <dependency><groupId>${group}</groupId><artifactId>${artifactId}</artifactId><version>${version}</version></dependency>`,
    ),
    "  </dependencies>",
    "</project>",
  ].join("\n");

// A repo1 stand-in serving the given modules at the version, each with its POM and jar.
async function repository(modules: Record<string, string>): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "central-wait-"));

  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

  for (const [artifactId, modulePom] of Object.entries(modules)) {
    const base = join(
      directory,
      "io/github/jubasse",
      artifactId,
      VERSION,
      `${artifactId}-${VERSION}`,
    );

    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(`${base}.pom`, modulePom);
    writeFileSync(`${base}.jar`, "classes");
  }

  const work = mkdtempSync(join(tmpdir(), "central-wait-work-"));

  cleanups.push(() => rmSync(work, { recursive: true, force: true }));

  const portal = await startLocalPortal(directory, work);

  cleanups.push(portal.close);

  return `${portal.url}/maven2`;
}

const wait = (url: string) => ({
  repository: url,
  version: VERSION,
  pollIntervalMilliseconds: 1,
  timeoutMilliseconds: 50,
});

describe("the wait for the plugin's Central dependencies", () => {
  it("reads the seampact dependencies of a POM, and refuses one at another version", () => {
    const pluginPom = pom(
      [JVM_GROUP, "seampact-runner", VERSION],
      ["org.jetbrains.kotlinx", "kotlinx-serialization-json", "1.8.0"],
    );

    expect(seampactDependencies(pluginPom, VERSION, "plugin.pom")).toEqual([
      { group: JVM_GROUP, artifactId: "seampact-runner" },
    ]);
    expect(() =>
      seampactDependencies(pom([JVM_GROUP, "seampact-runner", "1.2.2"]), VERSION, "plugin.pom"),
    ).toThrow(
      "plugin.pom depends on io.github.jubasse:seampact-runner:1.2.2, not on the release version 1.2.3",
    );
  });

  it("returns once Central serves each dependency and theirs", async () => {
    const url = await repository({
      "seampact-runner": pom([JVM_GROUP, "seampact-ir", VERSION]),
      "seampact-ir": pom(),
    });

    await expect(
      waitForCentralModules(wait(url), [{ group: JVM_GROUP, artifactId: "seampact-runner" }]),
    ).resolves.toEqual(["seampact-runner", "seampact-ir"]);
  });

  it("fails by name once the time is up on a dependency Central does not serve", async () => {
    const url = await repository({ "seampact-runner": pom([JVM_GROUP, "seampact-ir", VERSION]) });

    await expect(
      waitForCentralModules(wait(url), [{ group: JVM_GROUP, artifactId: "seampact-runner" }]),
    ).rejects.toThrow(
      new RegExp(
        `/io/github/jubasse/seampact-ir/${VERSION}/seampact-ir-${VERSION}\\.pom is still not served after .* minutes, and the Gradle plugin depends on it: check publish-maven-central, then rerun this job once Central serves it; nothing was published to the Plugin Portal$`,
      ),
    );
  });
});
