// The body the three probe generators share: a `defineTarget` target that answers what its options say, and with
// `echo: true` writes the request it received to `request.json`. The oracle harness hands `defineTarget`, Prettier's
// `format` and the IR version through `globalThis.seampactOracleProbe`.

const { existsSync, readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const PACKAGE_VERSION = "1.0.0";
const REQUEST_FILE = "request.json";
const JSON_INDENT = 2;

function oracleTools() {
  const tools = globalThis.seampactOracleProbe;

  if (tools === undefined) throw new Error("the oracle harness did not set seampactOracleProbe");

  return tools;
}

const sortedByKey = (record) =>
  Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );

// The version of `<packageName>` installed in a `node_modules` at or above `directory`; null when there is none.
function installedVersion(directory, packageName) {
  let current = directory;

  for (;;) {
    const file = join(current, "node_modules", packageName, "package.json");

    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).version ?? null;

    const parent = dirname(current);

    if (parent === current) return null;

    current = parent;
  }
}

function requestOf(input, runtimePackages) {
  return {
    api: input.ir.api.id,
    operations: input.ir.operations.map((operation) => operation.id),
    links: sortedByKey(input.links),
    artefacts: [...input.artefacts].sort(),
    frameworkRoutes: input.frameworkRoutes,
    hookCheck: input.hookCheck,
    mount: input.mount,
    importSpecifiers: input.importSpecifiers,
    installedRuntimes: Object.fromEntries(
      [...runtimePackages]
        .sort()
        .map((name) => [name, installedVersion(input.outputDirectory, name)]),
    ),
    ...(input.nativeDocsDocument === undefined
      ? {}
      : { nativeDocsDocument: input.nativeDocsDocument }),
  };
}

function generateFrom(runtimePackages) {
  return (input) => {
    const options = input.options;

    if (options.refusals !== undefined) return { status: "refused", refusals: options.refusals };

    const files = [...(options.files ?? [])];

    if (options.echo === true)
      files.push({
        path: REQUEST_FILE,
        contents: JSON.stringify(requestOf(input, runtimePackages), null, JSON_INDENT),
      });

    return {
      status: "generated",
      files,
      ...(options.warnings === undefined ? {} : { warnings: options.warnings }),
    };
  };
}

// `describe` is given for a provider only: it answers the options' refusals, else their descriptors.
function describeOptions(_ir, options) {
  if (options.refusals !== undefined) return { status: "refused", refusals: options.refusals };

  return { status: "described", descriptors: options.descriptors ?? {} };
}

function probeTarget({ id, runtimePackages = [], provider = false, kinds, ...metadata }) {
  const tools = oracleTools();

  return tools.defineTarget({
    metadata: {
      packageName: id,
      packageVersion: PACKAGE_VERSION,
      irSupport: {
        irVersions: [tools.irVersion],
        irRevision: tools.irRevision,
        kinds,
        features: [],
      },
      ...metadata,
    },
    format: tools.format,
    parseOptions: (raw) => ({ status: "parsed", options: raw ?? {} }),
    generate: generateFrom(runtimePackages),
    ...(provider ? { describe: describeOptions } : {}),
  });
}

module.exports = { probeTarget };
