import { fileURLToPath } from "node:url";
import type { ContractIR } from "@seampact/spec/ir";
import type { Diagnostic } from "../../../diagnostics/diagnostic.js";
import { loadFsReader, loadWorkspace } from "../../../load/index.js";
import { loadMemoryReader } from "../../../load/reader.js";
import { type DraftFixtureApi, draftFixture } from "../../../pipeline/draft-fixture.js";
import {
  createDraftIR,
  type DraftIR,
  pipelineContext,
  pipelineCopy,
  pipelineGuard,
  type TreeSchemaService,
} from "../../../pipeline/seam.js";
import type { RawApi, RawWorkspace } from "../../../raw-tree.js";
import { validateWorkspace } from "../../../validate/index.js";
import { accessIdentityPass } from "../../access/identity/index.js";
import { accessRightsPass } from "../../access/rights/index.js";
import { treeNodesPass } from "../../tree/nodes/index.js";
import { treeSchemasPass } from "../../tree/schemas/index.js";
import { deriveWirePass } from "../wire/index.js";
import { deriveErrorsPass } from "./pass.js";
import type { DeriveErrorsContext } from "./registry.js";

// Test support of derive.errors, outside the barrel: inline contracts run through the tree and access halves, the
// reference contract from its after-access fixture draft, and a guarded run of the half.

const FIXTURES = fileURLToPath(new URL("../../../../../../../fixtures/", import.meta.url));

/** A surface with one public route, which inline contracts end with. */
export const DERIVE_ERRORS_PING_SURFACE = `
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks error declarations and role bindings only. }
    routes:
      ping: { method: get }
`;

/** The directory of this lane's fixtures. */
export const DERIVE_ERRORS_FIXTURES = `${FIXTURES}passes/derive-errors/`;

const REFERENCE_CONTRACT = `${FIXTURES}reference/`;

// A loaded workspace that also passes the validate stage, as every contract a half receives does.
function loaded(workspace: ReturnType<typeof loadWorkspace>, what: string): RawWorkspace {
  if (workspace.diagnostics.length > 0)
    throw new Error(`${what} does not load: ${JSON.stringify(workspace.diagnostics)}`);

  const validated = validateWorkspace(workspace.workspace);
  const invalid = [...validated.workspace, ...validated.apis.flatMap((api) => api.diagnostics)];

  if (invalid.length > 0) throw new Error(`${what} is not valid: ${JSON.stringify(invalid)}`);

  return workspace.workspace;
}

/** A workspace from in-memory files, its entry `api.yaml`; load or validate diagnostics throw. */
export function deriveErrorsLoadFiles(files: Record<string, string>): RawWorkspace {
  return loaded(
    loadWorkspace({ reader: loadMemoryReader(files), entry: "api.yaml" }),
    "the inline contract",
  );
}

/** A workspace from a directory of this lane's fixtures, its entry `api.yaml`. */
export function deriveErrorsLoadFixture(name: string): RawWorkspace {
  const directory = `${DERIVE_ERRORS_FIXTURES}${name}/`;

  return loaded(loadWorkspace({ reader: loadFsReader(directory), entry: "api.yaml" }), directory);
}

/** The reference workspace. */
export function deriveErrorsReferenceWorkspace(): RawWorkspace {
  return loaded(
    loadWorkspace({ reader: loadFsReader(REFERENCE_CONTRACT), entry: "workspace.yaml" }),
    REFERENCE_CONTRACT,
  );
}

function apiOf(workspace: RawWorkspace, name?: string): RawApi {
  const api =
    name === undefined
      ? workspace.apis[0]
      : workspace.apis.find((candidate) => candidate.name === name);

  if (api === undefined) throw new Error(`the workspace has no api ${name ?? ""}`);

  return api;
}

export interface DeriveErrorsRun {
  readonly draft: DraftIR;
  readonly diagnostics: Diagnostic[];
  /** The context the half ran with, for the binding readers. */
  readonly context: DeriveErrorsContext;
}

function runOn(
  raw: RawApi,
  workspace: RawWorkspace,
  draft: DraftIR,
  treeSchemas: TreeSchemaService,
  sources: Pick<DeriveErrorsRunOptions, "relayed" | "imports"> = {},
): DeriveErrorsRun {
  const { relayed, imports } = sources;
  const diagnostics: Diagnostic[] = [];
  const context = Object.freeze({
    ...pipelineContext({
      raw,
      workspace,
      ...(relayed === undefined ? {} : { relayed }),
      ...(imports === undefined ? {} : { imports }),
      report: (diagnostic) => diagnostics.push(diagnostic),
      guard: true,
    }),
    treeSchemas,
  });
  const guarded = pipelineGuard(draft, deriveErrorsPass);

  try {
    deriveErrorsPass.run(guarded.draft, context);
  } finally {
    guarded.dispose();
  }

  return { draft, diagnostics, context };
}

/** Which api of the workspace a run compiles (the first by default), and the derived drafts its relay routes read. */
export interface DeriveErrorsRunOptions {
  readonly api?: string;
  readonly relayed?: ReadonlyMap<string, DraftIR>;
  readonly imports?: ReadonlyMap<string, ContractIR>;
}

/** Runs the tree, access and derive.wire halves, then derive.errors (guarded), on an api of `workspace`. */
export function deriveErrorsRunContract(
  workspace: RawWorkspace,
  options: DeriveErrorsRunOptions = {},
): DeriveErrorsRun {
  const raw = apiOf(workspace, options.api);
  const { relayed, imports } = options;
  const draft = createDraftIR();
  const diagnostics: Diagnostic[] = [];
  const context = pipelineContext({
    raw,
    workspace,
    ...(relayed === undefined ? {} : { relayed }),
    ...(imports === undefined ? {} : { imports }),
    report: (diagnostic) => diagnostics.push(diagnostic),
  });
  const treeSchemas = treeSchemasPass.run(draft, context);
  const later = Object.freeze({ ...context, treeSchemas });

  for (const half of [treeNodesPass, accessIdentityPass, accessRightsPass, deriveWirePass]) {
    half.run(draft, later);

    if (diagnostics.length > 0)
      throw new Error(`${half.half} reports on the contract: ${JSON.stringify(diagnostics)}`);
  }

  return runOn(raw, workspace, draft, treeSchemas, options);
}

// The real schema service of an api (the fixture service answers no error params position), and the draft its run
// fills, which holds the core schemas tree.schemas seeds.
function schemaServiceOf(
  raw: RawApi,
  workspace: RawWorkspace,
): { service: TreeSchemaService; seeded: DraftIR } {
  const diagnostics: Diagnostic[] = [];
  const seeded = createDraftIR();
  const service = treeSchemasPass.run(
    seeded,
    pipelineContext({ raw, workspace, report: (diagnostic) => diagnostics.push(diagnostic) }),
  );

  if (diagnostics.length > 0)
    throw new Error(`tree.schemas reports on ${raw.name}: ${JSON.stringify(diagnostics)}`);

  return { service, seeded };
}

const REFERENCE_PUBLIC_API = "tasks";

/**
 * Runs derive.errors (guarded) on the after-access fixture draft of a reference api, given the schemas tree.schemas
 * seeds that the fixture draft lacks (the core issue item of `schemaInvalid`). The reference service relays the
 * public api, so its run reads the public api's draft as derive.errors leaves it.
 */
export function deriveErrorsRunReference(
  workspace: RawWorkspace,
  api: DraftFixtureApi,
): DeriveErrorsRun {
  const raw = apiOf(workspace, api);
  const { service, seeded } = schemaServiceOf(raw, workspace);
  const draft = draftFixture(api, "after-access");

  for (const [id, schema] of Object.entries(seeded.schemas))
    if (!Object.hasOwn(draft.schemas, id)) draft.schemas[id] = pipelineCopy(schema);

  const relayed =
    api === REFERENCE_PUBLIC_API
      ? undefined
      : new Map([
          [REFERENCE_PUBLIC_API, deriveErrorsRunReference(workspace, REFERENCE_PUBLIC_API).draft],
        ]);

  return runOn(raw, workspace, draft, service, relayed === undefined ? {} : { relayed });
}

/** A diagnostic as the tests compare it: its rule and where it is located. */
export const deriveErrorsLocated = (
  diagnostic: Diagnostic,
): { rule: string; pointer: string; related: string[] } => ({
  rule: diagnostic.rule,
  pointer: diagnostic.origin.pointer,
  related: diagnostic.related.map((item) => item.origin.pointer),
});
