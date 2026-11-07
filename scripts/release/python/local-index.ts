// The rehearsal's local Python index, a static tree any HTTP server serves: the uploaded files under `files/`, a
// PEP 503 simple index under `simple/` (each link carries its `#sha256=`), and the PyPI JSON API of each release under
// `pypi/<name>/<version>/json`, which pypi-plan reads. An upload adds files and rewrites the pages; a file already
// there with other bytes is refused, as PyPI refuses it.
//   node scripts/release/python/local-index.ts <upload-dir> <index-root>
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsedArguments, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError } from "../release-version.ts";
import { distributionIdentity, fileSha256 } from "./dist-manifest.ts";

const FILES_DIRECTORY = "files";
const SIMPLE_DIRECTORY = "simple";
const JSON_API_DIRECTORY = "pypi";

/** Adds the upload directory's files to the index; returns how many it added. */
export function uploadToLocalIndex(uploadDirectory: string, indexRoot: string): number {
  const files = join(indexRoot, FILES_DIRECTORY);

  mkdirSync(files, { recursive: true });

  const uploads = readdirSync(uploadDirectory).sort();

  for (const file of uploads) {
    distributionIdentity(file);

    const held = join(files, file);

    if (existsSync(held) && fileSha256(held) !== fileSha256(join(uploadDirectory, file)))
      throw new ReleaseError(
        `${file} is on the local index with other bytes: an index never replaces a file`,
      );
  }

  for (const file of uploads) copyFileSync(join(uploadDirectory, file), join(files, file));

  writeIndexPages(indexRoot);

  return uploads.length;
}

function writeIndexPages(indexRoot: string): void {
  const held = readdirSync(join(indexRoot, FILES_DIRECTORY))
    .sort()
    .map((file) => ({
      file,
      ...distributionIdentity(file),
      sha256: fileSha256(join(indexRoot, FILES_DIRECTORY, file)),
    }));
  const names = [...new Set(held.map((entry) => entry.name))];

  for (const generated of [SIMPLE_DIRECTORY, JSON_API_DIRECTORY])
    rmSync(join(indexRoot, generated), { recursive: true, force: true });

  mkdirSync(join(indexRoot, SIMPLE_DIRECTORY));
  writeFileSync(
    join(indexRoot, SIMPLE_DIRECTORY, "index.html"),
    htmlPage(names.map((name) => `<a href="${name}/">${name}</a>`)),
  );

  for (const name of names) {
    const files = held.filter((entry) => entry.name === name);

    mkdirSync(join(indexRoot, SIMPLE_DIRECTORY, name));
    writeFileSync(
      join(indexRoot, SIMPLE_DIRECTORY, name, "index.html"),
      htmlPage(
        files.map(
          (entry) =>
            `<a href="../../${FILES_DIRECTORY}/${entry.file}#sha256=${entry.sha256}">${entry.file}</a>`,
        ),
      ),
    );

    for (const version of [...new Set(files.map((entry) => entry.version))]) {
      const release = join(indexRoot, JSON_API_DIRECTORY, name, version);
      const urls = files
        .filter((entry) => entry.version === version)
        .map((entry) => ({ filename: entry.file, digests: { sha256: entry.sha256 } }));

      mkdirSync(release, { recursive: true });
      writeFileSync(join(release, "json"), JSON.stringify({ info: { name, version }, urls }));
    }
  }
}

function htmlPage(links: readonly string[]): string {
  return `<!DOCTYPE html>\n<html><body>\n${links.join("<br>\n")}\n</body></html>\n`;
}

const USAGE = "node scripts/release/python/local-index.ts <upload-dir> <index-root>";

if (import.meta.main)
  await runReleaseCommand("local-index", () => {
    const { positionals } = parsedArguments({}, USAGE);
    const [uploadDirectory, indexRoot] = positionals;

    if (uploadDirectory === undefined || indexRoot === undefined)
      throw new ReleaseError(
        `the upload directory and the index root are required; usage: ${USAGE}`,
      );

    console.log(
      `local-index: ${uploadToLocalIndex(uploadDirectory, indexRoot)} files uploaded to ${indexRoot}`,
    );
  });
