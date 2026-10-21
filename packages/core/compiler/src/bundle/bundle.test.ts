import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { expect, test } from "vitest";
import { loadFsReader, loadMemoryReader } from "../load/reader.js";
import { buildBundle } from "./build.js";
import {
  builtContents,
  GOLDEN_REFERENCE,
  PACK_CONTRACT,
  REFERENCE,
  REFERENCE_CONTRACT,
  referenceBuildOptions,
  temporaryDirectory,
} from "./bundle.test-support.js";
import { writeBundle } from "./write.js";

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

test("bundle of the reference contract", () => {
  const output = join(temporaryDirectory(), "bundle");
  const written = writeBundle({ ...referenceBuildOptions(), output: { directory: output } });

  expect(written.ok).toBe(true);

  // The IR of each api, byte for byte the golden IR, and no side table.
  for (const api of ["tasks", "tasksService"])
    expect(readFileSync(join(output, "ir", `${api}.json`), "utf8")).toBe(
      readFileSync(join(GOLDEN_REFERENCE, `${api}.ir.json`), "utf8"),
    );

  // Every file the contract is made of, as authored, and nothing generated.
  const sources = filesUnder(REFERENCE).map((file) => `sources/${file}`);

  expect(filesUnder(output)).toEqual(
    ["ir/tasks.json", "ir/tasksService.json", "seampact-bundle.json", ...sources].sort(),
  );

  for (const file of filesUnder(REFERENCE))
    expect(readFileSync(join(output, "sources", file))).toEqual(
      readFileSync(join(REFERENCE, file)),
    );

  const manifest = JSON.parse(readFileSync(join(output, "seampact-bundle.json"), "utf8"));

  expect(manifest.contract).toEqual(REFERENCE_CONTRACT);
  expect(manifest.apis.map((api: { name: string }) => api.name)).toEqual(["tasks", "tasksService"]);
  expect(manifest.integrity).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/u);
});

test("a contract applying an npm pack vendors it", () => {
  const contents = builtContents({ reader: loadMemoryReader(PACK_CONTRACT), entry: "api.yaml" });

  expect([...contents.files.keys()].sort()).toEqual([
    "ir/t.json",
    "sources/.packs/@acme/pack-a@1.2.0/lib/pack.yaml",
    "sources/.packs/@acme/pack-a@1.2.0/package.json",
    "sources/api.yaml",
  ]);
  expect(contents.manifest.contract).toEqual({ name: "@acme/contract", version: "3.1.0" });
  expect(contents.manifest.packs).toEqual([{ name: "@acme/pack-a", version: "1.2.0" }]);
});

function writeFiles(directory: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), text);
  }
}

test("a pack reached through a node_modules symlink is vendored", () => {
  // The pnpm layout: the package directory is a link to the pack's real directory, outside the workspace root.
  const root = temporaryDirectory();
  const packPrefix = "node_modules/@acme/pack-a/";
  const contract = join(root, "contract");
  const pack = join(root, "packs", "pack-a");
  const entries = Object.entries(PACK_CONTRACT);

  writeFiles(
    contract,
    Object.fromEntries(entries.filter(([file]) => !file.startsWith(packPrefix))),
  );
  writeFiles(
    pack,
    Object.fromEntries(
      entries
        .filter(([file]) => file.startsWith(packPrefix))
        .map(([file, text]) => [file.slice(packPrefix.length), text]),
    ),
  );
  mkdirSync(join(contract, "node_modules", "@acme"), { recursive: true });
  symlinkSync(pack, join(contract, "node_modules", "@acme", "pack-a"), "junction");

  const contents = builtContents({ reader: loadFsReader(contract), entry: "api.yaml" });

  expect([...contents.files.keys()].sort()).toEqual([
    "ir/t.json",
    "sources/.packs/@acme/pack-a@1.2.0/lib/pack.yaml",
    "sources/.packs/@acme/pack-a@1.2.0/package.json",
    "sources/api.yaml",
  ]);
});

test("a workspace importing pinned bundles is refused by name", () => {
  const built = buildBundle({
    reader: loadMemoryReader({
      "workspace.yaml":
        "workspace:\n  apis: [api.yaml]\n  imports:\n    billing: { package: '@acme/billing', version: 1.0.0, api: billing, integrity: sha256-x }\n",
      "api.yaml": "api: { name: t, version: 1 }\n",
    }),
    entry: "workspace.yaml",
    contract: REFERENCE_CONTRACT,
  });

  expect(!built.ok && built.failures).toMatchObject([
    {
      code: "bundle.imports-unsupported",
      file: "workspace.yaml",
      message: expect.stringContaining("'billing'"),
    },
  ]);
});

test("a compile error writes nothing", () => {
  const output = join(temporaryDirectory(), "bundle");
  const written = writeBundle({
    reader: loadMemoryReader({ "api.yaml": "api: { name: t }\nunknownMember: 1\n" }),
    entry: "api.yaml",
    contract: REFERENCE_CONTRACT,
    output: { directory: output },
  });

  expect(written.ok).toBe(false);
  expect(!written.ok && written.failures.map((failure) => failure.code)).toEqual([
    "bundle.compile-failed",
  ]);
  expect(
    !written.ok &&
      written.compiled?.apis.flatMap((api) => api.diagnostics).map((diagnostic) => diagnostic.rule),
  ).toContain("seampact/validate/unknown-keyword");
  expect(existsSync(output)).toBe(false);
});

test("a contract with no name or version, or an unportable file name, is refused by name", () => {
  const { "package.json": _, ...unnamed } = PACK_CONTRACT;
  const noContract = buildBundle({ reader: loadMemoryReader(unnamed), entry: "api.yaml" });

  expect(!noContract.ok && noContract.failures).toMatchObject([
    {
      code: "bundle.contract-missing",
      file: "package.json",
      message: expect.stringContaining("name and version"),
      fix: expect.stringContaining("--name and --version"),
    },
  ]);

  const unportable = buildBundle({
    reader: loadMemoryReader({ "api file.yaml": "api: { name: t, version: 1 }\n" }),
    entry: "api file.yaml",
    contract: REFERENCE_CONTRACT,
  });

  expect(!unportable.ok && unportable.failures).toMatchObject([
    {
      code: "bundle.path-unportable",
      file: "api file.yaml",
      message: expect.stringContaining("U+0020"),
    },
  ]);
});

test("a contract label outside printable ASCII is refused before it is written", () => {
  for (const name of ["", "acme contract"]) {
    const built = buildBundle({
      reader: loadMemoryReader(PACK_CONTRACT),
      entry: "api.yaml",
      contract: { name },
    });

    expect(!built.ok && built.failures.map((failure) => failure.code), name).toEqual([
      "bundle.label-invalid",
    ]);
  }
});

test("the bundle carries the text the IR was compiled from, never a second read", () => {
  const memory = loadMemoryReader(PACK_CONTRACT);
  const readCounts = new Map<string, number>();
  const built = buildBundle({
    entry: "api.yaml",
    reader: {
      ...memory,
      readText(file, maxBytes) {
        const count = (readCounts.get(file) ?? 0) + 1;
        const read = memory.readText(file, maxBytes);

        readCounts.set(file, count);

        // An edit after the load stage read the file.
        return file === "api.yaml" && count > 1 && read !== undefined && "text" in read
          ? { text: `${read.text}# edited\n` }
          : read;
      },
    },
  });
  const source = built.ok ? built.contents.files.get("sources/api.yaml") : undefined;

  expect(new TextDecoder().decode(source)).toBe(PACK_CONTRACT["api.yaml"]);
});

test("a directory output must be new or empty", () => {
  const output = temporaryDirectory();

  expect(writeBundle({ ...referenceBuildOptions(), output: { directory: output } }).ok).toBe(true);
  expect(writeBundle({ ...referenceBuildOptions(), output: { directory: output } })).toMatchObject({
    ok: false,
    failures: [{ code: "bundle.output-not-empty", file: output }],
  });
});
