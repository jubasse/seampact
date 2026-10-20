import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, test } from "vitest";
import BUNDLE_VECTORS from "../../vectors/bundle/vectors.json" with { type: "json" };
import BUNDLE_VECTORS_SCHEMA from "../../vectors/bundle/vectors.schema.json" with { type: "json" };
import { canonicalBundleFileList } from "./file-list.js";
import {
  BUNDLE_MANIFEST_SCHEMA,
  type BundleApi,
  type BundleFile,
  type BundleManifest,
  type BundleNamedVersion,
} from "./manifest.js";
import { bundleManifestRuleProblems } from "./manifest-rules.js";
import { BUNDLE_PATH_DEVICE_PATTERN, BUNDLE_PATH_PATTERN, bundlePathProblem } from "./path.js";

const validate = new Ajv2020({ allErrors: true, strict: true }).compile<BundleManifest>(
  BUNDLE_MANIFEST_SCHEMA,
);

const HASH = "0".repeat(64);

const MANIFEST: BundleManifest = {
  formatVersion: 1,
  contract: { name: "@acme/contract", version: "1.0.0" },
  apis: [{ name: "tasks", file: "ir/tasks.json", irVersion: 1, irRevision: 6 }],
  compiler: { name: "@seampact/compiler", version: "0.0.0" },
  packs: [{ name: "@acme/pack-a", version: "1.2.0" }],
  files: [
    { path: "ir/tasks.json", size: 2, sha256: HASH },
    { path: "sources/.packs/@acme/pack-a@1.2.0/pack.yaml", size: 1, sha256: HASH },
    { path: "sources/workspace.yaml", size: 1, sha256: HASH },
  ],
  integrity: `sha256-${"A".repeat(43)}=`,
};

// The schema's verdict, then the rules', as one list of problem names.
function problemsOf(manifest: unknown): string[] {
  if (!validate(manifest))
    return (validate.errors ?? []).map((error) => `schema ${error.keyword} ${error.instancePath}`);

  return bundleManifestRuleProblems(manifest).map((problem) => `rule ${problem.pointer}`);
}

function withFiles(...paths: string[]): BundleManifest {
  return {
    ...MANIFEST,
    files: [...MANIFEST.files, ...paths.map((path) => ({ path, size: 1, sha256: HASH }))],
  };
}

test("manifest schema accepts and refuses by rule", () => {
  expect(problemsOf(MANIFEST)).toEqual([]);

  const { integrity: _, ...noIntegrity } = MANIFEST;

  expect(problemsOf(noIntegrity)).toEqual(["schema required "]);
  expect(problemsOf({ ...MANIFEST, signature: "x" })).toEqual(["schema additionalProperties "]);
  expect(problemsOf({ ...MANIFEST, formatVersion: 2 })).toEqual(["schema const /formatVersion"]);

  for (const path of [
    "sources/a b.yaml",
    "sources/../x",
    "sources/./x",
    "sources//x",
    "/sources/x",
    "other/x",
    "sources",
    "sources/é",
  ])
    expect(problemsOf(withFiles(path)), path).toContain("schema pattern /files/3/path");

  // One file on Windows with another name, or a device there: refused before any Windows reader meets them.
  for (const path of ["sources/a.", "sources/...", "sources/x./y.yaml"])
    expect(problemsOf(withFiles(path)), path).toContain("schema pattern /files/3/path");

  for (const path of [
    "sources/CON.yaml",
    "sources/nul",
    "sources/Aux.tar.gz",
    "sources/com1",
    "sources/LPT9.yaml",
    "sources/prn/a.yaml",
  ])
    expect(problemsOf(withFiles(path)), path).toContain("schema not /files/3/path");

  for (const path of [
    "sources/console.yaml",
    "sources/x.con",
    "sources/com10.yaml",
    "sources/.nul",
  ])
    expect(bundlePathProblem(path), path).toBeUndefined();

  // Labels are printable ASCII.
  for (const label of ["", "a b", "caf\u00e9", "x\u001b"])
    expect(
      problemsOf({ ...MANIFEST, contract: { name: label, version: "1.0.0" } }).length,
      label,
    ).toBeGreaterThan(0);

  // Sorted by path, so a duplicate is out of order; case folds are one file on a case-insensitive file system.
  expect(problemsOf(withFiles("sources/workspace.yaml"))).toEqual(["rule /files/3/path"]);
  expect(problemsOf(withFiles("sources/z.yaml", "sources/a.yaml"))).toEqual(["rule /files/4/path"]);
  expect(
    problemsOf({
      ...MANIFEST,
      files: [
        ...MANIFEST.files.slice(0, 2),
        { path: "sources/Workspace.yaml", size: 1, sha256: HASH },
        ...MANIFEST.files.slice(2),
      ],
    }),
  ).toEqual(["rule /files/3/path"]);

  // Each api once, at ir/<name>.json and listed; every ir/ file an api's.
  expect(
    problemsOf({ ...MANIFEST, apis: [{ ...MANIFEST.apis[0], file: "ir/other.json" }] }),
  ).toEqual(["rule /apis/0/file", "rule /files/0/path"]);
  expect(problemsOf({ ...MANIFEST, apis: [...MANIFEST.apis, ...MANIFEST.apis] })).toEqual([
    "rule /apis/1/name",
  ]);
  expect(problemsOf({ ...MANIFEST, packs: [...MANIFEST.packs, ...MANIFEST.packs] })).toEqual([
    "rule /packs/1",
  ]);
});

test("the types and the schema list the same members", () => {
  const manifestMembers = {
    formatVersion: true,
    contract: true,
    apis: true,
    compiler: true,
    packs: true,
    files: true,
    integrity: true,
  } satisfies Record<keyof BundleManifest, true>;
  const apiMembers = { name: true, file: true, irVersion: true, irRevision: true } satisfies Record<
    keyof BundleApi,
    true
  >;
  const fileMembers = { path: true, size: true, sha256: true } satisfies Record<
    keyof BundleFile,
    true
  >;
  const namedMembers = { name: true, version: true } satisfies Record<
    keyof BundleNamedVersion,
    true
  >;
  const schema = structuredClone(BUNDLE_MANIFEST_SCHEMA) as {
    required: string[];
    properties: Record<string, { required?: string[]; items?: { required: string[] } }>;
  };

  expect(schema.required.sort()).toEqual(Object.keys(manifestMembers).sort());
  expect(schema.properties.apis?.items?.required.sort()).toEqual(Object.keys(apiMembers).sort());
  expect(schema.properties.files?.items?.required.sort()).toEqual(Object.keys(fileMembers).sort());

  for (const member of ["contract", "compiler"])
    expect(schema.properties[member]?.required?.sort()).toEqual(Object.keys(namedMembers).sort());
  expect(schema.properties.packs?.items?.required.sort()).toEqual(Object.keys(namedMembers).sort());
});

test("the path rule and the schema pattern agree", () => {
  const samples = [
    "sources/a.yaml",
    "ir/x.json",
    "sources/.packs/@a/b@1.0.0+x/y-z_w.yaml",
    "sources/...",
    "sources/.a",
    "sources/..a",
    "sources/.",
    "sources/..",
    "sources/a/",
    "x/a",
    "sources/a~b",
    "sources/a.",
    "sources/b..",
    "sources/CON",
    "sources/con.yaml",
    "sources/conx.yaml",
    "sources/COM0.a.b",
    "sources/LPT",
    "ir/aux.json",
  ];

  for (const path of samples)
    expect(bundlePathProblem(path) === undefined, path).toBe(
      BUNDLE_PATH_PATTERN.test(path) && !BUNDLE_PATH_DEVICE_PATTERN.test(path),
    );
});

test("the canonical file list is sorted, one line per file, the last one ended", () => {
  expect(
    canonicalBundleFileList([
      { path: "sources/b", sha256: "b" },
      { path: "ir/a", sha256: "a" },
      { path: "sources/B", sha256: "c" },
    ]),
  ).toBe("a  ir/a\nc  sources/B\nb  sources/b\n");
});

const TEXT_REFUSALS = ["manifest-not-utf8", "manifest-byte-order-mark", "manifest-duplicate-key"];

test("the schema accepts every vector manifest but the invalid ones", () => {
  for (const vector of BUNDLE_VECTORS.directories) {
    const manifestFile = vector.files.find((file) => file.path === "seampact-bundle.json");

    // Refused before the schema: not UTF-8, a byte order mark, a key given twice.
    if (manifestFile === undefined || TEXT_REFUSALS.includes(vector.id)) continue;
    const manifest: unknown = JSON.parse(
      Buffer.from(manifestFile.base64, "base64").toString("utf8"),
    );
    const refused = vector.expected.failures.some(
      (failure) => failure.code === "bundle.manifest-invalid",
    );

    expect(problemsOf(manifest).length > 0, vector.id).toBe(refused);
  }
});

test("the vectors follow their schema", () => {
  const validateVectors = new Ajv2020({ allErrors: true, strict: true }).compile(
    BUNDLE_VECTORS_SCHEMA,
  );

  expect(validateVectors(BUNDLE_VECTORS), JSON.stringify(validateVectors.errors)).toBe(true);
});
