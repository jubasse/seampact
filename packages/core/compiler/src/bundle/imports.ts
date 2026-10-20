import type { BundleSource } from "@seampact/spec/config";
import type { ContractIR } from "@seampact/spec/ir";
import { finalizeIsRecord } from "../finalize/record.js";
import { loadWorkspace } from "../load/index.js";
import {
  compileWorkspace,
  type PipelineOptions,
  type PipelineResult,
} from "../pipeline/orchestrator.js";
import { quote } from "../validate/diagnostics.js";
import { type BundleFetchOptions, fetchBundle } from "./fetch.js";
import { type BundleSourceFailure, bundleSourceText } from "./fetch-failure.js";

// A workspace compiled with the apis it imports from pinned bundles (`workspace.imports`, ADR 0002 section 1, ADR
// 0011): each entry's bundle is fetched and put through the pinned-bundle check, its `api` looked up in the
// manifest, and the IR passed to `compileWorkspace` as the `imports` option under the entry's name, so a relay
// reads it as it reads a sibling api (FR-8). An entry the workspace schema refuses (no source form, or more than one)
// is not fetched: the compilation reports it.

export interface WorkspaceImportsOptions extends PipelineOptions {
  /** How the bundles are fetched: `baseDirectory` is the workspace root. */
  readonly fetch: BundleFetchOptions;
}

export interface WorkspaceImportFailure {
  /** The entry's name in `workspace.imports`. */
  readonly name: string;
  readonly failures: readonly BundleSourceFailure[];
}

export type WorkspaceImportsResult =
  | { readonly ok: true; readonly compiled: PipelineResult }
  | { readonly ok: false; readonly failures: readonly WorkspaceImportFailure[] };

interface DeclaredImport {
  readonly name: string;
  readonly api: string;
  readonly source: BundleSource;
}

/** Fetches and checks every import the workspace declares, then compiles it with their IRs. */
export async function compileWorkspaceWithImports(
  options: WorkspaceImportsOptions,
): Promise<WorkspaceImportsResult> {
  const loaded = loadWorkspace({ reader: options.reader, entry: options.entry });
  const declared = declaredImports(loaded.workspace.config?.imports);

  if (declared.length === 0) return { ok: true, compiled: compileWorkspace(options) };

  const imports = new Map<string, ContractIR>(options.imports ?? []);
  const failures: WorkspaceImportFailure[] = [];

  for (const each of declared) {
    const imported = await importedIr(each, options.fetch);

    if ("failures" in imported) failures.push({ name: each.name, failures: imported.failures });
    else imports.set(each.name, imported.ir);
  }

  if (failures.length > 0) return { ok: false, failures };

  return { ok: true, compiled: compileWorkspace({ ...options, imports }) };
}

async function importedIr(
  declared: DeclaredImport,
  fetchOptions: BundleFetchOptions,
): Promise<{ readonly ir: ContractIR } | { readonly failures: readonly BundleSourceFailure[] }> {
  const fetched = await fetchBundle(declared.source, fetchOptions);

  if (!fetched.ok) return { failures: fetched.failures };

  const ir = fetched.irs.get(declared.api);

  if (ir !== undefined) return { ir };

  const apis = fetched.manifest.apis.map((api) => quote(api.name)).join(", ");

  return {
    failures: [
      {
        code: "bundle.import-api-missing",
        message: `The bundle of ${bundleSourceText(declared.source)} holds no api ${quote(declared.api)}; it holds ${apis}.`,
        fix: `Name one of the bundle's apis in the import's 'api' (${apis}).`,
      },
    ],
  };
}

// The key that names each source form; an entry holds exactly one.
const SOURCE_FORM_KEYS = ["path", "package", "release", "git"] as const;

// The entries of `workspace.imports` whose shape the workspace schema accepts, in declaration order.
function declaredImports(imports: unknown): DeclaredImport[] {
  if (!finalizeIsRecord(imports)) return [];

  return Object.entries(imports).flatMap(([name, entry]) => {
    if (!finalizeIsRecord(entry) || typeof entry.api !== "string") return [];

    const source = bundleSourceOf(entry);

    return source === undefined ? [] : [{ name, api: entry.api, source }];
  });
}

function bundleSourceOf(entry: Record<string, unknown>): BundleSource | undefined {
  if (SOURCE_FORM_KEYS.filter((key) => key in entry).length !== 1) return undefined;

  const integrity = typeof entry.integrity === "string" ? { integrity: entry.integrity } : {};
  const { release, git } = entry;

  if (typeof entry.package === "string" && typeof entry.version === "string")
    return { package: entry.package, version: entry.version, ...integrity };

  if (finalizeIsRecord(release) && typeof release.url === "string")
    return { release: { url: release.url }, ...integrity };

  if (!finalizeIsRecord(git) || typeof git.url !== "string" || typeof git.tag !== "string")
    return undefined;

  const directory = typeof git.directory === "string" ? { directory: git.directory } : {};

  return { git: { url: git.url, tag: git.tag, ...directory }, ...integrity };
}
