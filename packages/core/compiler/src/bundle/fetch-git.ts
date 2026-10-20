import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  BUNDLE_ENTRIES_MAX,
  BUNDLE_EXTRACTED_BYTES_MAX,
  BUNDLE_MANIFEST_FILE,
  bundlePathFold,
  bundlePathProblem,
} from "@seampact/spec/bundle";
import type { GitBundleSource } from "@seampact/spec/config";
import { quote } from "../validate/diagnostics.js";
import type { BundleSourceFailure } from "./fetch-failure.js";
import type { LocalSourcePolicy } from "./local-sources.js";

// The git-tag channel: a shallow fetch of the tag with the system `git` into a new bare repository, then the files
// of the tag's tree read with `git ls-tree` and `git cat-file`, never through a work tree, so `autocrlf`,
// attributes, smudge filters and LFS cannot change a byte. Only `https:` and `ssh` repositories are fetched, plus
// local ones (`file:` or a path) when local sources are allowed; `ext::` is off. The tree is untrusted: a link, a
// submodule, an unportable path or a case-fold duplicate is refused before anything is written.

const run = promisify(execFile);

const GIT = "git";
const TEMPORARY_PREFIX = "seampact-git-";
const REPOSITORY = "repository";
const FILES = "files";
const FETCHED = "FETCH_HEAD";
const GIT_OUTPUT_BYTES_MAX = BUNDLE_EXTRACTED_BYTES_MAX;
const REGULAR_FILE_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);
const URL_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//u;
const DRIVE_PATH = /^[A-Za-z]:[\\/]/u;
// `[user@]host:path`, git's scp-like ssh form: a colon before any slash, after a host longer than a drive letter.
const SCP_LIKE = /^[^/:]{2,}:/u;
const REMOTE_PROTOCOLS = "https:ssh";
const LOCAL_PROTOCOL = "file";

export type GitFetch =
  | { readonly ok: true; readonly directory: string; readonly remove: () => void }
  | { readonly ok: false; readonly failure: BundleSourceFailure };

/** Why the source cannot be fetched before any git command runs: its URL, its tag, its directory. */
export function gitSourceProblem(
  source: GitBundleSource,
  localSources: LocalSourcePolicy,
): BundleSourceFailure | undefined {
  const url = source.git.url;
  const scheme = URL_SCHEME.exec(url)?.[1]?.toLowerCase();

  if (scheme !== undefined && !["https", "ssh", LOCAL_PROTOCOL].includes(scheme))
    return {
      code: "bundle.git-url",
      message: `The git URL ${quote(url)} uses '${scheme}:'; a bundle is fetched over https: or ssh only.`,
      fix: "Name the repository by its https: or ssh URL.",
    };

  if (isLocalRepository(url) && localSources === "refuse")
    return {
      code: "bundle.source-local",
      message: `The git repository ${quote(url)} is local, and local sources are refused here.`,
      fix: "Name the repository by its https: or ssh URL.",
    };

  if (bundleDirectoryPrefix(source.git.directory) === undefined)
    return badDirectory(source.git.directory);

  if (source.git.tag.startsWith("-") || source.git.tag.includes(".."))
    return badTag(source.git.tag);

  return undefined;
}

/** The bundle directory of the tag's tree, written into a new temporary directory; `remove` deletes it. */
export async function fetchGitBundle(
  source: GitBundleSource,
  baseDirectory: string,
  localSources: LocalSourcePolicy,
): Promise<GitFetch> {
  const problem = gitSourceProblem(source, localSources);

  if (problem !== undefined) return { ok: false, failure: problem };

  const url = repositoryUrl(source.git.url, baseDirectory);
  const prefix = bundleDirectoryPrefix(source.git.directory) ?? "";
  const temporary = mkdtempSync(join(tmpdir(), TEMPORARY_PREFIX));
  const remove = () => rmSync(temporary, { recursive: true, force: true });
  const git = gitRunner(join(temporary, REPOSITORY), localSources);

  try {
    await run(GIT, ["init", "--quiet", "--bare", join(temporary, REPOSITORY)], git.options);
    await git.run([
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "--no-tags",
      "--",
      url,
      `refs/tags/${source.git.tag}`,
    ]);

    const written = await writeTree(git, prefix, join(temporary, FILES));

    if (written !== undefined) {
      remove();

      return { ok: false, failure: written };
    }
  } catch (error) {
    remove();

    return { ok: false, failure: gitFailed(source, error) };
  }

  return { ok: true, directory: join(temporary, FILES), remove };
}

function isLocalRepository(url: string): boolean {
  const scheme = URL_SCHEME.exec(url)?.[1]?.toLowerCase();

  if (scheme !== undefined) return scheme === LOCAL_PROTOCOL;

  return DRIVE_PATH.test(url) || !SCP_LIKE.test(url);
}

// A local path as a `file:` URL, relative to the base directory; any other URL as written.
function repositoryUrl(url: string, baseDirectory: string): string {
  if (!isLocalRepository(url) || URL_SCHEME.test(url)) return url;

  return pathToFileURL(isAbsolute(url) ? url : resolve(baseDirectory, url)).href;
}

// `directory` as a tree path prefix (`""` for the root, else `a/b/`), or undefined when it is not a plain relative
// path.
function bundleDirectoryPrefix(directory: string | undefined): string | undefined {
  if (directory === undefined) return "";

  const segments = directory.replace(/\/+$/u, "").split("/");
  const isPlain = segments.every(
    (segment) => segment !== "" && segment !== "." && segment !== ".." && !segment.includes("\\"),
  );

  return isPlain ? `${segments.join("/")}/` : undefined;
}

interface GitRunner {
  readonly options: { env: NodeJS.ProcessEnv; maxBuffer: number };
  run(args: readonly string[]): Promise<Buffer>;
}

function gitRunner(repository: string, localSources: LocalSourcePolicy): GitRunner {
  const options = {
    env: {
      ...process.env,
      GIT_ALLOW_PROTOCOL:
        localSources === "allow" ? `${REMOTE_PROTOCOLS}:${LOCAL_PROTOCOL}` : REMOTE_PROTOCOLS,
      GIT_TERMINAL_PROMPT: "0",
    },
    maxBuffer: GIT_OUTPUT_BYTES_MAX,
  };

  return {
    options,
    run: async (args) => {
      const done = await run(GIT, ["-c", "protocol.ext.allow=never", "-C", repository, ...args], {
        ...options,
        encoding: "buffer",
      });

      return done.stdout;
    },
  };
}

interface TreeFile {
  readonly path: string;
  readonly object: string;
}

// Reads the tree below `prefix` and writes its files under `target`, or the failure refusing it.
async function writeTree(
  git: GitRunner,
  prefix: string,
  target: string,
): Promise<BundleSourceFailure | undefined> {
  const listing = await git.run(["ls-tree", "-r", "-z", "--full-tree", FETCHED]);
  const files = treeFiles(listing.toString("utf8"), prefix);

  if (!Array.isArray(files)) return files;

  mkdirSync(target);
  let total = 0;

  for (const file of files) {
    const bytes = await git.run(["cat-file", "blob", file.object]);

    total += bytes.length;

    if (total > BUNDLE_EXTRACTED_BYTES_MAX)
      return {
        code: "bundle.archive-extracted-too-large",
        message: `The tag's bundle files hold more than ${BUNDLE_EXTRACTED_BYTES_MAX} bytes.`,
        fix: "Check that the source names a seampact bundle; a bundle this large is not one.",
        expected: String(BUNDLE_EXTRACTED_BYTES_MAX),
      };

    const path = join(target, ...file.path.split("/"));

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes, { flag: "wx" });
  }

  return undefined;
}

// The listing's entries below `prefix`, each checked as the archive reader checks a tarball entry.
function treeFiles(listing: string, prefix: string): TreeFile[] | BundleSourceFailure {
  const files: TreeFile[] = [];
  const folded = new Set<string>();

  for (const line of listing.split("\0")) {
    if (line === "") continue;

    const tab = line.indexOf("\t");
    const [mode = "", type = "", object = ""] = line.slice(0, tab).split(" ");
    const fullPath = line.slice(tab + 1);

    if (!fullPath.startsWith(prefix)) continue;

    const path = fullPath.slice(prefix.length);

    if (type !== "blob" || !REGULAR_FILE_MODES.has(mode))
      return {
        code: "bundle.archive-entry-type",
        message: `${quote(path)} is a link or a submodule in the tag's tree; a bundle holds regular files only.`,
        fix: "Commit the bundle's files as regular files.",
        file: path,
      };

    const problem = path === BUNDLE_MANIFEST_FILE ? undefined : bundlePathProblem(path);

    if (problem !== undefined)
      return {
        code: "bundle.archive-entry-path",
        message: `${quote(path)} in the tag's tree is not a bundle path: ${problem}.`,
        fix: "Point `directory` at the bundle directory, which holds the manifest, `sources/` and `ir/` only.",
        file: path,
      };

    if (folded.has(bundlePathFold(path)))
      return {
        code: "bundle.archive-entry-duplicate",
        message: `${quote(path)} differs only by letter case from another file of the tag's tree.`,
        fix: "Keep one of the two files.",
        file: path,
      };

    folded.add(bundlePathFold(path));
    files.push({ path, object });

    if (files.length > BUNDLE_ENTRIES_MAX)
      return {
        code: "bundle.archive-too-many-entries",
        message: `The tag's bundle directory holds more than ${BUNDLE_ENTRIES_MAX} files.`,
        fix: "Check that the source names a seampact bundle; a bundle this large is not one.",
        expected: String(BUNDLE_ENTRIES_MAX),
      };
  }

  return files;
}

function badDirectory(directory: string | undefined): BundleSourceFailure {
  return {
    code: "bundle.git-directory",
    message: `The git directory ${quote(directory ?? "")} is not a relative path inside the repository.`,
    fix: "Name the bundle directory relative to the repository root, without '.', '..' or a backslash.",
  };
}

function badTag(tag: string): BundleSourceFailure {
  return {
    code: "bundle.git-tag",
    message: `The git tag ${quote(tag)} is not a tag name.`,
    fix: "Name the tag the bundle was committed under.",
  };
}

function gitFailed(source: GitBundleSource, error: unknown): BundleSourceFailure {
  const stderr =
    error instanceof Error && "stderr" in error ? String(error.stderr).trim() : String(error);

  return {
    code: "bundle.git-failed",
    message: `Fetching tag '${source.git.tag}' of ${quote(source.git.url)} with git failed: ${quote(stderr)}.`,
    fix: "Check the URL, the tag and your access to the repository, and that `git` is on the PATH.",
  };
}
