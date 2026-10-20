import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FIRST_PARTY_PROVIDERS,
  SERVER_TARGETS,
} from "../../packages/core/spec/src/compatibility/index.ts";
import type { AgreementRow } from "../golden/agreement.ts";

// Like the golden scripts, the runner imports the target packages by path: the root TypeScript project forbids
// the parameter properties their dependencies use, so a static import would make `pnpm typecheck` report them.
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const CODEGEN_CORE_ENTRY = join(REPO_ROOT, "packages/core/codegen-core/src/index.ts");
const TARGETS_DIRECTORY = "packages/targets";
const PACKAGE_SCOPE = "@seampact/";
const INPUT_ISSUES_ENTRY = join(
  REPO_ROOT,
  "packages/core/codegen-core/node-server-runtime/input-issues.ts",
);
const BODY_PART = "body";
const GENERATED_ROOT = "generated";

// The libraries each validators provider's generated code imports, resolved from the provider package's copy.
const PROVIDER_LIBRARIES: Readonly<Record<string, readonly string[]>> = {
  zod: ["zod"],
  yup: ["yup"],
  "class-validator": ["class-validator", "class-transformer", "reflect-metadata"],
  ajv: ["ajv"],
};

const TYPES_PROVIDER_ID = "ts";
const OWN_VALIDATORS_DIRECTORY = "validators";
const TYPES_LOCATION = { kind: "relative", path: "types" };

// The providers whose schema modules export plain library schemas that a support module wraps into a Standard Schema.
const WRAPS_STANDARD_SCHEMA: ReadonlySet<string> = new Set(["yup"]);

export interface StandardResult {
  value?: unknown;
  issues?: readonly { path?: readonly PropertyKey[] }[];
}

interface StandardSchema {
  "~standard": { validate(value: unknown): Promise<StandardResult> | StandardResult };
}

export interface Verdict {
  verdict: "accept" | "reject";
  rules: string[];
  value?: unknown;
}

export interface ProviderValidators {
  id: string;
  verdictOf(row: AgreementRow, payload: unknown): Promise<Verdict>;
}

interface GeneratedFile {
  path: string;
}

interface Outcome {
  status: string;
  files?: GeneratedFile[];
  refusals?: { member: string }[];
}

interface Target {
  generate(request: {
    ir: object;
    options: object;
    links: object;
    artefacts: Set<string>;
  }): Promise<Outcome>;
  describe(ir: object, options: object): { status: string; descriptors?: { types?: object } };
}

interface CodegenCore {
  writeGeneratedFiles(directory: string, packageName: string, files: unknown): Promise<Outcome>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function importModule(path: string): Promise<Record<string, unknown>> {
  const loaded: unknown = await import(pathToFileURL(path).href);

  if (!isRecord(loaded)) throw new Error(`${path} is not a module`);

  return loaded;
}

function isTarget(value: unknown): value is Target {
  return (
    isRecord(value) && typeof value.generate === "function" && typeof value.describe === "function"
  );
}

function targetOf(module: Record<string, unknown>, path: string): Target {
  const target = module.target;

  if (!isTarget(target)) throw new Error(`${path} does not export a target with generate`);

  return target;
}

function isCodegenCore(
  value: Record<string, unknown>,
): value is Record<string, unknown> & CodegenCore {
  return typeof value.writeGeneratedFiles === "function";
}

function codegenCoreOf(module: Record<string, unknown>): CodegenCore {
  if (!isCodegenCore(module)) throw new Error("codegen-core does not export writeGeneratedFiles");

  return module;
}

/**
 * The ids of the validators of the compatibility matrix, the first-party providers then the validators a target
 * generates itself; the runner covers each or fails by name.
 */
export function validatorProviderIds(): string[] {
  const providerIds = FIRST_PARTY_PROVIDERS.filter(
    (provider) => provider.kind === "validators",
  ).map((provider) => provider.id);
  const ownIds = SERVER_TARGETS.flatMap((target) =>
    target.ownValidators.map((validator) => validator.id),
  );

  return [...providerIds, ...ownIds];
}

// The target package that offers a validators id: the provider's own package, or the target that generates it.
function offeringPackage(providerId: string): string | undefined {
  const provider = FIRST_PARTY_PROVIDERS.find((candidate) => candidate.id === providerId);

  if (provider !== undefined) return provider.package;

  return SERVER_TARGETS.find((target) =>
    target.ownValidators.some((validator) => validator.id === providerId),
  )?.package;
}

function isOwnValidators(providerId: string): boolean {
  return !FIRST_PARTY_PROVIDERS.some((provider) => provider.id === providerId);
}

async function yupStandardSchemaOf(
  outputDirectory: string,
): Promise<(schema: unknown) => StandardSchema> {
  const wrap = (await importModule(join(outputDirectory, "yup-support.ts"))).standardSchemaOf;

  if (typeof wrap !== "function")
    throw new Error("yup-support.ts does not export standardSchemaOf");

  return (schema) => wrap(schema);
}

function schemaOf(schemas: Record<string, unknown>, row: AgreementRow): StandardSchema {
  const schema = schemas[`${row.schema}Schema`];

  if (!isStandardSchema(schema)) {
    throw new Error(`${row.id}: no generated ${row.direction} validator for ${row.schema}`);
  }

  return schema;
}

function isStandardSchema(value: unknown): value is StandardSchema {
  return (
    isRecord(value) &&
    isRecord(value["~standard"]) &&
    typeof value["~standard"].validate === "function"
  );
}

interface InputIssue {
  pointer: string;
  rule: string;
}

// The server boundary's own naming of the issues, so the runner compares the rules a boundary would render.
type IssueNamer = (candidate: unknown, issues: readonly object[]) => InputIssue[];

async function boundaryIssueNamer(): Promise<IssueNamer> {
  const named = (await importModule(INPUT_ISSUES_ENTRY)).inputIssues;

  if (typeof named !== "function")
    throw new Error("the server runtime does not export inputIssues");

  return (candidate, issues) => named(candidate, issues);
}

function verdictFrom(result: StandardResult, payload: unknown, nameIssues: IssueNamer): Verdict {
  if (result.issues === undefined) return { verdict: "accept", rules: [], value: result.value };

  const candidate = { [BODY_PART]: payload };
  // A prototype link keeps a library's own issue members (`code`, `origin`) that a spread would drop.
  const underBody = result.issues.map((issue) =>
    Object.create(issue, { path: { value: [BODY_PART, ...(issue.path ?? [])] } }),
  );
  const rules = nameIssues(candidate, underBody).map((issue) => `${issue.pointer} ${issue.rule}`);

  return { verdict: "reject", rules: [...new Set(rules)].sort() };
}

function linkLibraries(
  projectRoot: string,
  packageDirectory: string,
  libraries: readonly string[],
) {
  mkdirSync(join(projectRoot, "node_modules"));

  for (const library of libraries) {
    symlinkSync(
      join(REPO_ROOT, packageDirectory, "node_modules", library),
      join(projectRoot, "node_modules", library),
      "dir",
    );
  }
}

interface ProviderTarget {
  packageName: string;
  packageDirectory: string;
  libraries: readonly string[];
  target: Target;
  // Where the validators land below the generated root: a provider writes at the root, a server target below
  // `validators/`.
  validatorsDirectory: string;
  linksFor(ir: object): object;
}

async function providerTarget(providerId: string): Promise<ProviderTarget> {
  const packageName = offeringPackage(providerId);
  const libraries = PROVIDER_LIBRARIES[providerId];

  if (packageName === undefined || libraries === undefined) {
    throw new Error(`the agreement runner has no library list for the provider ${providerId}`);
  }

  const own = isOwnValidators(providerId);
  const typesTarget = own ? await typesProviderTarget() : undefined;

  return {
    packageName,
    packageDirectory: join(TARGETS_DIRECTORY, packageName.slice(PACKAGE_SCOPE.length)),
    libraries,
    target: await packageTarget(packageName),
    validatorsDirectory: own ? OWN_VALIDATORS_DIRECTORY : "",
    linksFor: (ir) => (typesTarget === undefined ? {} : typesLinkOf(typesTarget, ir)),
  };
}

async function packageTarget(packageName: string): Promise<Target> {
  const entry = join(
    REPO_ROOT,
    TARGETS_DIRECTORY,
    packageName.slice(PACKAGE_SCOPE.length),
    "src/index.ts",
  );

  return targetOf(await importModule(entry), entry);
}

async function typesProviderTarget(): Promise<Target> {
  const provider = FIRST_PARTY_PROVIDERS.find((candidate) => candidate.id === TYPES_PROVIDER_ID);

  if (provider === undefined) {
    throw new Error(`the matrix has no '${TYPES_PROVIDER_ID}' provider`);
  }

  return packageTarget(provider.package);
}

// A server target needs a `types` link even when only its validators are generated; the types are not written.
function typesLinkOf(typesTarget: Target, ir: object): object {
  const described = typesTarget.describe(ir, {});

  if (described.status !== "described" || described.descriptors?.types === undefined) {
    throw new Error(`the types provider does not describe the agreement contract`);
  }

  return { types: { descriptor: described.descriptors.types, location: TYPES_LOCATION } };
}

function generateValidators(provider: ProviderTarget, ir: object): Promise<Outcome> {
  return provider.target.generate({
    ir,
    options: {},
    links: provider.linksFor(ir),
    artefacts: new Set(["validators"]),
  });
}

/** The IR locations a provider refuses to generate, such as `/schemas/Counts`; empty when it generates all. */
export async function refusedMembers(providerId: string, ir: object): Promise<string[]> {
  const outcome = await generateValidators(await providerTarget(providerId), ir);

  if (outcome.status === "generated") return [];

  return (outcome.refusals ?? []).map((refusal) => refusal.member);
}

/** Generates one provider's validators from the IR into a temporary project and imports its schema modules. */
export async function loadProviderValidators(
  providerId: string,
  ir: object,
): Promise<ProviderValidators> {
  const provider = await providerTarget(providerId);
  const { packageName, packageDirectory, libraries, validatorsDirectory } = provider;
  const core = codegenCoreOf(await importModule(CODEGEN_CORE_ENTRY));
  const outcome = await generateValidators(provider, ir);

  if (outcome.status !== "generated") {
    throw new Error(`${providerId}: ${JSON.stringify(outcome.refusals)}`);
  }

  const projectRoot = mkdtempSync(join(tmpdir(), `seampact-agreement-${providerId}-`));
  const outputDirectory = join(projectRoot, GENERATED_ROOT);
  const validatorsRoot = join(outputDirectory, validatorsDirectory);
  const written = await core.writeGeneratedFiles(outputDirectory, packageName, outcome.files);

  if (written.status !== "written")
    throw new Error(`${providerId}: ${JSON.stringify(written.refusals)}`);

  linkLibraries(projectRoot, packageDirectory, libraries);
  writeFileSync(join(projectRoot, "package.json"), '{ "type": "module" }\n');
  writeFileSync(
    join(projectRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2024", experimentalDecorators: true } }),
  );

  // class-validator's DTOs read decorator metadata, so the polyfill loads before any generated module.
  if (libraries.includes("reflect-metadata")) {
    await importModule(join(projectRoot, "node_modules", "reflect-metadata", "Reflect.js"));
  }

  // yup's schema modules export plain yup schemas; its support module wraps them into the contract's Standard Schema.
  const standardSchemaOf = WRAPS_STANDARD_SCHEMA.has(providerId)
    ? await yupStandardSchemaOf(validatorsRoot)
    : undefined;
  const modules = {
    input: await importModule(join(validatorsRoot, "schemas/input.ts")),
    output: await importModule(join(validatorsRoot, "schemas/output.ts")),
  };

  const nameIssues = await boundaryIssueNamer();

  return {
    id: providerId,
    async verdictOf(row, payload) {
      const generated = schemaOf(modules[row.direction], row);
      const schema = standardSchemaOf === undefined ? generated : standardSchemaOf(generated);

      return verdictFrom(await schema["~standard"].validate(payload), payload, nameIssues);
    },
  };
}
