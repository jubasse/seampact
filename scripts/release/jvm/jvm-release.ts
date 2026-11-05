// What the JVM side of a release publishes, read from the JVM build so it has one source: the modules of
// `jvm/settings.gradle.kts`, the Gradle plugin and its marker, and the compiler's classifier per release asset from
// `compiler-publication.gradle.kts`. Maven Central takes every module but the Gradle plugin; the Gradle Plugin Portal
// takes the plugin and its marker.
import { ReleaseError } from "../release-version.ts";
import { readRepositoryFile } from "../version-edit.ts";

export const JVM_GROUP = "io.github.jubasse";
export const GRADLE_PLUGIN_MODULE = "seampact-gradle-plugin";
export const GRADLE_PLUGIN_ID = "io.github.jubasse.seampact";
export const COMPILER_MODULE = "seampact-compiler";
export const DOCS_URL = "https://jubasse.github.io/seampact/";

const SETTINGS_FILE = "jvm/settings.gradle.kts";
const COMPILER_PUBLICATION_FILE = "jvm/seampact-compiler/compiler-publication.gradle.kts";
const INCLUDED_MODULE = /^include\("(seampact-[a-z-]+)"\)$/gm;
const CLASSIFIER_ENTRY = /^\s*"(seampact-[a-z0-9.-]+)" to "([a-z0-9_-]+)",$/gm;

export const CHANNELS = ["central", "plugin-portal"] as const;
export type Channel = (typeof CHANNELS)[number];

/** A Maven coordinate without its version. */
export interface Coordinate {
  readonly group: string;
  readonly artifactId: string;
}

/** What one channel's bundle holds at one version. */
export interface ExpectedBundle {
  readonly version: string;
  readonly coordinates: readonly Coordinate[];
  /** The compiler's classifier per release asset, for the channel that publishes the compiler. */
  readonly compilerClassifiers: ReadonlyMap<string, string>;
}

export function isChannel(candidate: string): candidate is Channel {
  return (CHANNELS as readonly string[]).includes(candidate);
}

export function jvmModules(root: string): string[] {
  const modules = [...readRepositoryFile(root, SETTINGS_FILE).matchAll(INCLUDED_MODULE)].map(
    (match) => match[1] ?? "",
  );

  if (!modules.includes(GRADLE_PLUGIN_MODULE) || !modules.includes(COMPILER_MODULE))
    throw new ReleaseError(
      `${SETTINGS_FILE} includes no ${GRADLE_PLUGIN_MODULE} or no ${COMPILER_MODULE}: the JVM release reads its modules there`,
    );

  return modules;
}

/** Release asset to Maven classifier, as the compiler publication stages them. */
export function compilerClassifiers(root: string): Map<string, string> {
  const entries = [
    ...readRepositoryFile(root, COMPILER_PUBLICATION_FILE).matchAll(CLASSIFIER_ENTRY),
  ].map((match): [string, string] => [match[1] ?? "", match[2] ?? ""]);

  if (entries.length === 0)
    throw new ReleaseError(
      `${COMPILER_PUBLICATION_FILE} has no \`"<asset>" to "<classifier>",\` line: the bundle check reads the compiler's classifiers there`,
    );

  return new Map(entries);
}

export function expectedBundle(root: string, channel: Channel, version: string): ExpectedBundle {
  const modules = jvmModules(root);

  if (channel === "plugin-portal")
    return {
      version,
      coordinates: [
        { group: JVM_GROUP, artifactId: GRADLE_PLUGIN_MODULE },
        { group: GRADLE_PLUGIN_ID, artifactId: `${GRADLE_PLUGIN_ID}.gradle.plugin` },
      ],
      compilerClassifiers: new Map(),
    };

  return {
    version,
    coordinates: modules
      .filter((module) => module !== GRADLE_PLUGIN_MODULE)
      .map((artifactId) => ({ group: JVM_GROUP, artifactId })),
    compilerClassifiers: compilerClassifiers(root),
  };
}

/** The directory of a coordinate's version in a Maven repository layout. */
export function versionDirectory(coordinate: Coordinate, version: string): string {
  return [...coordinate.group.split("."), coordinate.artifactId, version].join("/");
}
