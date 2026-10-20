import {
  BUNDLE_FORMAT_VERSION,
  BUNDLE_IR_DIRECTORY,
  BUNDLE_SOURCES_DIRECTORY,
  type BundleApi,
  type BundleFailure,
  type BundleFile,
  type BundleNamedVersion,
  bundleLabelProblem,
  bundlePathFold,
  bundlePathProblem,
  compareBundlePaths,
} from "@seampact/spec/bundle";
import compilerPackage from "../../package.json" with { type: "json" };
import { finalizeSerializeIr } from "../finalize/serialize.js";
import type { LoadReader } from "../load/index.js";
import { LOAD_MAX_FILE_BYTES } from "../load/limits.js";
import { PACK_FILE, packageNameOf, packVendoredDirectory } from "../load/pack-files.js";
import type { LoadText } from "../load/reader.js";
import { compileWorkspace, type PipelineResult } from "../pipeline/orchestrator.js";
import { quote } from "../validate/diagnostics.js";
import type { BundleContents } from "./contents.js";
import { bundleIntegrity, bundleSha256Hex } from "./integrity.js";
import { ustarPathSplit } from "./ustar.js";

// The bundle of a workspace (ADR 0011 "The bundle"), in memory: the workspace compiled with no error, every file
// the load stage read under the workspace root as `sources/<path>`, every file of an npm pack as
// `sources/.packs/<name>@<version>/<path in the package>` (ADR 0008), the canonical IR of each api as
// `ir/<api>.json`, and the manifest over them. Rebuilding the IR from these sources is out of scope until a
// consumer needs it: no loader reads `sources/.packs/`.

export interface BundleBuildOptions {
  readonly reader: LoadReader;
  /** Root-relative path of the entry file, as `compileWorkspace` takes it. */
  readonly entry: string;
  /** The contract's name and version, over the workspace root `package.json` (the future `bundle --name --version`). */
  readonly contract?: Partial<BundleNamedVersion>;
}

export type BundleBuildResult =
  | { readonly ok: true; readonly contents: BundleContents }
  | {
      readonly ok: false;
      readonly failures: readonly BundleFailure[];
      /** The compilation, when it failed: its diagnostics are the failure's detail. */
      readonly compiled?: PipelineResult;
    };

const PACKAGE_MANIFEST = "package.json";

const COMPILER: BundleNamedVersion = {
  name: compilerPackage.name,
  version: compilerPackage.version,
};

/** The bundle of the workspace `options.entry` names, or every reason it cannot be made. */
export function buildBundle(options: BundleBuildOptions): BundleBuildResult {
  const recording = recordingReader(options.reader);
  const compiled = compileWorkspace({ reader: recording.reader, entry: options.entry });
  const errorCount = [
    ...compiled.diagnostics,
    ...compiled.apis.flatMap((api) => api.diagnostics),
  ].filter((diagnostic) => diagnostic.severity === "error").length;

  if (errorCount > 0) return { ok: false, failures: [compileFailure(errorCount)], compiled };

  const contract = contractOf(options);
  const sources = sourceFiles(options.reader, recording.texts, compiled.files);
  const irs = irFiles(compiled);
  const labels = labelFailures(contract.value, irs.packs);
  const failures = [...contract.failures, ...sources.failures, ...irs.failures, ...labels];

  if (contract.value === undefined || failures.length > 0) return { ok: false, failures };

  const files = new Map([...sources.files, ...irs.files]);
  const listed: BundleFile[] = [...files]
    .map(([path, bytes]) => ({ path, size: bytes.length, sha256: bundleSha256Hex(bytes) }))
    .sort((left, right) => compareBundlePaths(left.path, right.path));

  return {
    ok: true,
    contents: {
      manifest: {
        formatVersion: BUNDLE_FORMAT_VERSION,
        contract: contract.value,
        apis: irs.apis,
        compiler: { ...COMPILER },
        packs: irs.packs,
        files: listed,
        integrity: bundleIntegrity(listed),
      },
      files,
    },
  };
}

interface RecordingReader {
  readonly reader: LoadReader;
  /** The text of every file the load stage read, by root-relative path. */
  readonly texts: ReadonlyMap<string, string>;
}

// The reader the compilation uses, keeping each text it returns: the bundle carries the very text the IR was
// compiled from, never a second read.
function recordingReader(reader: LoadReader): RecordingReader {
  const texts = new Map<string, string>();

  return {
    texts,
    reader: {
      ascent: reader.ascent,
      listDir: (dir) => reader.listDir(dir),
      realPath: (file) => reader.realPath(file),
      readText(file, maxBytes): LoadText | undefined {
        const read = reader.readText(file, maxBytes);

        if (read !== undefined && "text" in read) texts.set(file, read.text);

        return read;
      },
    },
  };
}

// The manifest's names and versions are printable ASCII (`$defs/label`): refused here rather than written.
function labelFailures(
  contract: BundleNamedVersion | undefined,
  packs: readonly BundleNamedVersion[],
): BundleFailure[] {
  const labels = [
    ...(contract === undefined
      ? []
      : [
          { what: "contract name", value: contract.name },
          { what: "contract version", value: contract.version },
        ]),
    ...packs.flatMap((pack) => [
      { what: "pack name", value: pack.name },
      { what: `version of pack ${quote(pack.name)}`, value: pack.version },
    ]),
  ];

  return labels.flatMap(({ what, value }) => {
    const problem = bundleLabelProblem(value);

    return problem === undefined
      ? []
      : [
          {
            code: "bundle.label-invalid" as const,
            message: `The ${what} ${quote(value)} ${problem}; the manifest cannot hold it.`,
            fix: "Give the contract (package.json, or the passed name and version) and its packs names and versions of printable ASCII, at most 214 characters.",
          },
        ];
  });
}

function compileFailure(errorCount: number): BundleFailure {
  return {
    code: "bundle.compile-failed",
    message: `The workspace does not compile: ${errorCount} error diagnostic${errorCount === 1 ? "" : "s"}; no bundle was written.`,
    fix: "Fix the diagnostics `seampact compile` prints, then bundle again.",
  };
}

interface Gathered<T> {
  readonly value?: T;
  readonly failures: BundleFailure[];
}

function contractOf(options: BundleBuildOptions): Gathered<BundleNamedVersion> {
  const fromPackage = rootPackageContract(options.reader);
  const name = options.contract?.name ?? fromPackage.name;
  const version = options.contract?.version ?? fromPackage.version;

  if (name !== undefined && version !== undefined)
    return { value: { name, version }, failures: [] };

  const missing = [
    name === undefined ? "name" : undefined,
    version === undefined ? "version" : undefined,
  ]
    .filter((member) => member !== undefined)
    .join(" and ");

  return {
    failures: [
      {
        code: "bundle.contract-missing",
        message: `The contract has no ${missing}: ${fromPackage.problem ?? "the workspace root package.json gives none"}, and none was passed.`,
        fix: `Add "name" and "version" to the package.json at the workspace root, or pass the contract ${missing}.`,
        file: PACKAGE_MANIFEST,
      },
    ],
  };
}

// The `name` and `version` strings of the root package.json, and why it gave none when it is not JSON.
function rootPackageContract(
  reader: LoadReader,
): Partial<BundleNamedVersion> & { problem?: string } {
  const manifest = readPackageManifest(reader, PACKAGE_MANIFEST);

  if (typeof manifest === "string") return { problem: manifest };

  return {
    ...(typeof manifest?.name === "string" && manifest.name !== "" ? { name: manifest.name } : {}),
    ...(typeof manifest?.version === "string" && manifest.version !== ""
      ? { version: manifest.version }
      : {}),
  };
}

// The package.json's members, undefined when the file does not exist, or why it cannot be read.
function readPackageManifest(
  reader: LoadReader,
  file: string,
): Record<string, unknown> | string | undefined {
  const read = reader.readText(file, LOAD_MAX_FILE_BYTES);

  if (read === undefined) return undefined;

  if (!("text" in read)) return `'${file}' is larger than ${LOAD_MAX_FILE_BYTES} bytes`;

  try {
    const parsed: unknown = JSON.parse(read.text);

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? { ...parsed }
      : `'${file}' is not a JSON object`;
  } catch (error) {
    return `'${file}' is not JSON (${error instanceof Error ? error.message : String(error)})`;
  }
}

interface GatheredFiles {
  readonly files: Map<string, Uint8Array>;
  readonly failures: BundleFailure[];
}

function sourceFiles(
  reader: LoadReader,
  texts: ReadonlyMap<string, string>,
  loaded: readonly string[],
): GatheredFiles {
  const files = new Map<string, Uint8Array>();
  const failures: BundleFailure[] = [];
  const pathByFold = new Map<string, string>();
  const packDirectories = new Map<string, string | BundleFailure>();

  for (const source of loaded) {
    const text = texts.get(source);

    // The load stage also lists the files it looked for and did not find (or could not read): the compilation
    // succeeded without them.
    if (text === undefined) continue;

    const placed = bundlePathOf(reader, source, packDirectories);

    if (typeof placed !== "string") {
      failures.push(placed);
      continue;
    }

    const problem = writablePathProblem(placed) ?? caseProblem(pathByFold, placed);

    if (problem !== undefined) {
      failures.push(unportableFailure(source, placed, problem));
      continue;
    }

    pathByFold.set(bundlePathFold(placed), placed);
    files.set(placed, new TextEncoder().encode(text));
  }

  return { files, failures: dedupeFailures(failures) };
}

// The portable-path rule, and the room a tarball header has for a path.
function writablePathProblem(path: string): string | undefined {
  const problem = bundlePathProblem(path);

  if (problem !== undefined) return problem;

  return ustarPathSplit(path) === undefined
    ? "does not fit a tar header (a name of at most 100 characters after a directory of at most 155)"
    : undefined;
}

function caseProblem(pathByFold: ReadonlyMap<string, string>, path: string): string | undefined {
  const sameFold = pathByFold.get(bundlePathFold(path));

  if (sameFold === undefined) return undefined;

  return sameFold === path
    ? "is also the bundle file of another loaded file (one pack version installed in two places)"
    : `differs from '${sameFold}' only in letter case`;
}

// The bundle path of a loaded file, or the failure that keeps it out.
function bundlePathOf(
  reader: LoadReader,
  source: string,
  packDirectories: Map<string, string | BundleFailure>,
): string | BundleFailure {
  const pack = PACK_FILE.exec(source);

  if (pack !== null) {
    const [, packageDirectory = "", inside = ""] = pack;
    let vendored = packDirectories.get(packageDirectory);

    if (vendored === undefined) {
      vendored = vendoredDirectory(reader, packageDirectory);
      packDirectories.set(packageDirectory, vendored);
    }

    return typeof vendored === "string" ? `${vendored}/${inside}` : vendored;
  }

  if (source.startsWith("../") || source.startsWith("/") || /^[A-Za-z]:/u.test(source))
    return {
      code: "bundle.file-outside-root",
      message: `'${source}' is above the workspace root and in no pack, so the bundle cannot carry it.`,
      fix: "Move the file under the workspace root, or install it as a pack package.",
      file: source,
    };

  return `${BUNDLE_SOURCES_DIRECTORY}/${source}`;
}

// `sources/.packs/<name>@<version>`, the version read from the package's own package.json.
function vendoredDirectory(reader: LoadReader, packageDirectory: string): string | BundleFailure {
  const name = packageNameOf(packageDirectory);
  const manifestFile = `${packageDirectory}/${PACKAGE_MANIFEST}`;
  const manifest = readPackageManifest(reader, manifestFile);
  const version = typeof manifest === "object" ? manifest.version : undefined;

  if (typeof version === "string" && version !== "")
    return `${BUNDLE_SOURCES_DIRECTORY}/${packVendoredDirectory(name, version)}`;

  const problem =
    typeof manifest === "string" ? manifest : `'${manifestFile}' holds no version string`;

  return {
    code: "bundle.pack-unreadable",
    message: `The pack package '${name}' has no version the bundle can read: ${problem}.`,
    fix: "Reinstall the pack package, so its package.json holds a version string.",
    file: manifestFile,
  };
}

function unportableFailure(source: string, path: string, problem: string): BundleFailure {
  return {
    code: "bundle.path-unportable",
    message: `'${source}' would be the bundle file '${path}', which ${problem}.`,
    fix: "Rename the file (and its references) to letters, digits and . _ @ + -, so every reader lists it alike.",
    file: source,
  };
}

// A pack's failure is found once per file of the pack: reported once.
function dedupeFailures(failures: readonly BundleFailure[]): BundleFailure[] {
  return [
    ...new Map(
      failures.map((failure) => [`${failure.code} ${failure.file ?? ""}`, failure]),
    ).values(),
  ];
}

interface GatheredIrs extends GatheredFiles {
  readonly apis: BundleApi[];
  readonly packs: BundleNamedVersion[];
}

function irFiles(compiled: PipelineResult): GatheredIrs {
  const files = new Map<string, Uint8Array>();
  const failures: BundleFailure[] = [];
  const apis: BundleApi[] = [];
  const packs = new Map<string, BundleNamedVersion>();

  for (const api of compiled.apis) {
    if (api.ir === undefined)
      throw new Error(`bundle: api '${api.api}' compiled with no error and no IR.`);

    const file = `${BUNDLE_IR_DIRECTORY}/${api.api}.json`;
    const problem = writablePathProblem(file);

    if (problem !== undefined) {
      failures.push(unportableFailure(`api ${api.api}`, file, problem));
      continue;
    }

    files.set(file, new TextEncoder().encode(finalizeSerializeIr(api.ir)));
    apis.push({ name: api.api, file, irVersion: api.ir.irVersion, irRevision: api.ir.irRevision });

    for (const pack of api.ir.packs)
      packs.set(`${pack.name}@${pack.version}`, { name: pack.name, version: pack.version });
  }

  const sortedPacks = [...packs.values()].sort(
    (left, right) =>
      compareBundlePaths(left.name, right.name) || compareBundlePaths(left.version, right.version),
  );

  return {
    files,
    failures,
    apis: apis.sort((left, right) => compareBundlePaths(left.name, right.name)),
    packs: sortedPacks,
  };
}
