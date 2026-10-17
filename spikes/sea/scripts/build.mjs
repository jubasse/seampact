// Builds the five SEA binaries from one Linux host (ADR 0010).
// Usage: node scripts/build.mjs   (needs Node 24.21.0, gpg, curl, tar, unzip, xz)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { securityDirectory, stripSignature } from "./pe.mjs";

const NODE_VERSION = "24.21.0";
const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const ALLOWED_BUILTINS = new Set(["fs", "path", "crypto", "process"]);
// `yaml` imports `buffer` for its YAML 1.1 binary tag: the module is loaded at start-up but the
// call is never reached by the core schema; Buffer is a global in Node, so this is tolerated
// (yaml only, in both checks) and recorded in the README. Only module imports are checked.
const TOLERATED = new Map([["buffer", "/yaml/dist/"]]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const cache = join(root, ".cache");
const started = Date.now();

const targets = [
  {
    id: "linux-x64",
    archive: "linux-x64.tar.xz",
    exe: "bin/node",
    out: "seampact-spike-linux-x64",
  },
  {
    id: "linux-arm64",
    archive: "linux-arm64.tar.xz",
    exe: "bin/node",
    out: "seampact-spike-linux-arm64",
  },
  {
    id: "darwin-x64",
    archive: "darwin-x64.tar.xz",
    exe: "bin/node",
    out: "seampact-spike-darwin-x64",
    macho: true,
  },
  {
    id: "darwin-arm64",
    archive: "darwin-arm64.tar.xz",
    exe: "bin/node",
    out: "seampact-spike-darwin-arm64",
    macho: true,
  },
  { id: "win32-x64", archive: "win-x64.zip", exe: "node.exe", out: "seampact-spike-win32-x64.exe" },
];

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

if (process.version !== `v${NODE_VERSION}`) {
  fail(`needs Node ${NODE_VERSION} to build the blob, running ${process.version}`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "bin"), { recursive: true });
mkdirSync(cache, { recursive: true });

// 1. Bundle (CommonJS: the Node 24 SEA entry is a script) and check the Node API surface.
const result = await build({
  absWorkingDir: root,
  entryPoints: [join(root, "src/main.ts")],
  outfile: join(dist, "bundle.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});
const used = new Set();

for (const [file, input] of Object.entries(result.metafile.inputs)) {
  for (const imp of input.imports) {
    if (!imp.external) continue;
    const name = imp.path.replace(/^node:/, "");
    const via = TOLERATED.get(name);

    if (via && file.includes(via)) continue;
    used.add(name);
  }
}

const extra = [...used].filter((name) => !ALLOWED_BUILTINS.has(name));

if (extra.length > 0) fail(`Node APIs beyond fs, path, crypto and process: ${extra.join(", ")}`);
const bundleText = readFileSync(join(dist, "bundle.cjs"), "utf8");
// esbuild marks each module with a `// <path>` comment line: the tolerated import must sit in
// the section of its allowed package.
const sectionOf = (index) => {
  const marks = [...bundleText.slice(0, index).matchAll(/^\/\/ (\S.*)$/gm)];

  return marks.length > 0 ? marks[marks.length - 1][1] : "";
};

const dynamic = [...bundleText.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)]
  .map((m) => [m[1].replace(/^node:/, ""), m.index])
  .filter(([name, index]) => {
    if (ALLOWED_BUILTINS.has(name)) return false;
    const via = TOLERATED.get(name);

    return !(via && `/${sectionOf(index)}`.includes(via));
  })
  .map(([name]) => name);

if (dynamic.length > 0)
  fail(`bundle requires beyond fs, path, crypto and process: ${dynamic.join(", ")}`);
console.log(`build: bundle ok, builtins used: ${[...used].sort().join(", ")}`);

// 2. SEA blob: code cache and snapshot off (cross-platform), warning disabled. The paths are
// relative to dist/ (cwd of the blob step) so the blob does not depend on the checkout directory.
const seaConfig = join(dist, "sea-config.json");

writeFileSync(
  seaConfig,
  `${JSON.stringify(
    {
      main: "bundle.cjs",
      output: "sea.blob",
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2,
  )}\n`,
);
run(process.execPath, ["--experimental-sea-config", "sea-config.json"], { cwd: dist });

// 3. Official Node binaries, verified against the signed SHASUMS256.txt.
const base = `https://nodejs.org/dist/v${NODE_VERSION}`;
const download = (name) => {
  const file = join(cache, name);

  if (!existsSync(file))
    run("curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--output",
      file,
      `${base}/${name}`,
    ]);

  return file;
};

const shasums = download(`SHASUMS256.txt`);
const asc = download(`SHASUMS256.txt.asc`);
const gnupgHome = join(cache, "gnupg");

rmSync(gnupgHome, { recursive: true, force: true });
mkdirSync(gnupgHome, { mode: 0o700 });
const gpgEnv = { ...process.env, GNUPGHOME: gnupgHome, LC_ALL: "C" };

run("gpg", ["--batch", "--quiet", "--import", join(root, "node-release-keys.asc")], {
  env: gpgEnv,
});
// SHASUMS256.txt.asc is the clearsigned file: verify it and take the text it signs.
const status = execFileSync("gpg", ["--batch", "--status-fd", "1", "--verify", asc], {
  env: gpgEnv,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});

if (!/^\[GNUPG:\] GOODSIG /m.test(status) || !/^\[GNUPG:\] VALIDSIG /m.test(status)) {
  fail("SHASUMS256.txt.asc signature is not good");
}

const signed = execFileSync("gpg", ["--batch", "--decrypt", asc], {
  env: gpgEnv,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});

if (
  signed.replace(/\r\n/g, "\n").trim() !==
  readFileSync(shasums, "utf8").replace(/\r\n/g, "\n").trim()
) {
  fail("SHASUMS256.txt differs from the signed text");
}

console.log("build: SHASUMS256.txt signature verified against the pinned Node release keys");
const expected = new Map(
  signed
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, name] = line.split(/\s+/);

      return [name, hash];
    }),
);

// 4. Inject into each platform's binary.
const postject = join(root, "node_modules/.bin/postject");
const manifest = [];
const sizes = [];

for (const t of targets) {
  const name = `node-v${NODE_VERSION}-${t.archive}`;
  const archive = download(name);
  const want = expected.get(name);

  if (!want) fail(`${name} is not listed in SHASUMS256.txt`);

  if (sha256(archive) !== want) fail(`${name} does not match SHASUMS256.txt`);
  const work = join(cache, `x-${t.id}`);

  rmSync(work, { recursive: true, force: true });
  mkdirSync(work);

  if (t.archive.endsWith(".zip")) run("unzip", ["-q", archive, "-d", work]);
  else run("tar", ["-xf", archive, "-C", work]);
  const inner = join(
    work,
    `node-v${NODE_VERSION}-${t.archive.replace(/\.(tar\.xz|zip)$/, "")}`,
    t.exe,
  );
  const out = join(dist, "bin", t.out);

  copyFileSync(inner, out);
  chmodSync(out, 0o755);

  if (t.id === "win32-x64") {
    // The injection invalidates Node's Authenticode signature: remove it first (Node docs do
    // the same with `signtool remove /s`), then check the PE security directory is empty.
    const removed = stripSignature(out);

    if (removed === 0) fail("node.exe carried no signature to strip (expected one in 24.21.0)");
    console.log(`build: win32-x64 Authenticode signature removed (${removed} bytes)`);
  }

  const args = [out, "NODE_SEA_BLOB", join(dist, "sea.blob"), "--sentinel-fuse", SENTINEL];

  if (t.macho) args.push("--macho-segment-name", "NODE_SEA");
  run(postject, args);

  if (t.id === "win32-x64") {
    const { offset, size } = securityDirectory(out);

    if (offset !== 0 || size !== 0) fail("win32-x64 binary has a PE security directory");
  }

  sizes.push(
    `${t.out} ${statSync(out).size} gzip-9 ${gzipSync(readFileSync(out), { level: 9 }).length}`,
  );
  manifest.push(`${sha256(out)}  ${t.out}`);
  console.log(`build: ${t.id} done`);
}

writeFileSync(join(dist, "sizes.txt"), `${sizes.join("\n")}\n`);
writeFileSync(join(dist, "bin", "SHA256SUMS"), `${manifest.join("\n")}\n`);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

writeFileSync(join(dist, "build-seconds.txt"), `${seconds}\n`);
console.log(`build: five binaries in ${seconds} s`);
