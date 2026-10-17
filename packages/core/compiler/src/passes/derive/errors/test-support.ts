import { fileURLToPath } from "node:url";
import type { Diagnostic } from "../../../diagnostics/diagnostic.js";
import { loadFsReader, loadWorkspace } from "../../../load/index.js";
import { loadMemoryReader } from "../../../load/reader.js";
import { type DraftFixtureApi, draftFixture } from "../../../pipeline/draft-fixture.js";
import {
  createDraftIR,
  type DraftIR,
  pipelineContext,
  pipelineGuard,
  type TreeSchemaService,
} from "../../../pipeline/seam.js";
import type { RawApi, RawWorkspace } from "../../../raw-tree.js";
import { validateWorkspace } from "../../../validate/index.js";
import { accessIdentityPass } from "../../access/identity/index.js";
import { accessRightsPass } from "../../access/rights/index.js";
import { treeNodesPass } from "../../tree/nodes/index.js";
import { treeSchemasPass } from "../../tree/schemas/index.js";
import { deriveErrorsPass } from "./pass.js";
import type { DeriveErrorsContext } from "./registry.js";

// Test support of derive.errors, outside the barrel: inline contracts run through the tree and access halves, the
// reference contract from its after-access fixture draft, and a guarded run of the half.

const FIXTURES = fileURLToPath(new URL("../../../../../../../fixtures/", import.meta.url));

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
): DeriveErrorsRun {
  const diagnostics: Diagnostic[] = [];
  const context = Object.freeze({
    ...pipelineContext({
      raw,
      workspace,
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

/** Runs the tree and access halves, then derive.errors (guarded), on the first api of `workspace`. */
export function deriveErrorsRunContract(workspace: RawWorkspace): DeriveErrorsRun {
  const raw = apiOf(workspace);
  const draft = createDraftIR();
  const diagnostics: Diagnostic[] = [];
  const context = pipelineContext({
    raw,
    workspace,
    report: (diagnostic) => diagnostics.push(diagnostic),
  });
  const treeSchemas = treeSchemasPass.run(draft, context);
  const later = Object.freeze({ ...context, treeSchemas });

  for (const half of [treeNodesPass, accessIdentityPass, accessRightsPass]) {
    half.run(draft, later);

    if (diagnostics.length > 0)
      throw new Error(`${half.half} reports on the contract: ${JSON.stringify(diagnostics)}`);
  }

  return runOn(raw, workspace, draft, treeSchemas);
}

// The real schema service of an api: the fixture service answers no error params position.
function schemaServiceOf(raw: RawApi, workspace: RawWorkspace): TreeSchemaService {
  const diagnostics: Diagnostic[] = [];
  const service = treeSchemasPass.run(
    createDraftIR(),
    pipelineContext({ raw, workspace, report: (diagnostic) => diagnostics.push(diagnostic) }),
  );

  if (diagnostics.length > 0)
    throw new Error(`tree.schemas reports on ${raw.name}: ${JSON.stringify(diagnostics)}`);

  return service;
}

/** Runs derive.errors (guarded) on the after-access fixture draft of a reference api. */
export function deriveErrorsRunReference(
  workspace: RawWorkspace,
  api: DraftFixtureApi,
): DeriveErrorsRun {
  const raw = apiOf(workspace, api);

  return runOn(raw, workspace, draftFixture(api, "after-access"), schemaServiceOf(raw, workspace));
}

/** A diagnostic as the tests compare it: its rule and where it is located. */
export const deriveErrorsLocated = (
  diagnostic: Diagnostic,
): { rule: string; pointer: string; related: string[] } => ({
  rule: diagnostic.rule,
  pointer: diagnostic.origin.pointer,
  related: diagnostic.related.map((item) => item.origin.pointer),
});
