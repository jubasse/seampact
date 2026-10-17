import { fileURLToPath } from "node:url";
import type { Diagnostic } from "../../../diagnostics/diagnostic.js";
import { loadFsReader, loadWorkspace } from "../../../load/index.js";
import { loadMemoryReader } from "../../../load/reader.js";
import {
  DRAFT_FIXTURE_INVALID_EXAMPLE,
  type DraftFixtureApi,
  draftFixture,
  draftFixtureApply,
  draftFixtureHalves,
  draftFixtureSchemaService,
} from "../../../pipeline/draft-fixture.js";
import {
  createDraftIR,
  type DraftIR,
  pipelineContext,
  pipelineGuard,
  type TreeSchemaService,
} from "../../../pipeline/seam.js";
import type { RawApi, RawWorkspace } from "../../../raw-tree.js";
import { validateWorkspace } from "../../../validate/index.js";
import { treeNodesPass } from "../../tree/nodes/index.js";
import { treeSchemasPass } from "../../tree/schemas/index.js";
import { accessIdentityPass } from "../identity/index.js";
import { accessRightsPass } from "./pass.js";

// Test support of access.rights, outside the barrel: the reference contract with its fixture drafts, inline
// contracts run through tree.nodes, a small schema service for them, and a guarded run of the half.

const FIXTURES = fileURLToPath(new URL("../../../../../../../fixtures/", import.meta.url));

/** The directory of this lane's fixtures. */
export const ACCESS_RIGHTS_FIXTURES = `${FIXTURES}passes/access-rights/`;

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

/** A workspace from in-memory files, its entry `api.yaml`; load diagnostics throw. */
export function accessRightsLoadFiles(files: Record<string, string>): RawWorkspace {
  return loaded(
    loadWorkspace({ reader: loadMemoryReader(files), entry: "api.yaml" }),
    "the inline contract",
  );
}

/** A workspace from a directory of this lane's fixtures, its entry `api.yaml`; load diagnostics throw. */
export function accessRightsLoadFixture(name: string): RawWorkspace {
  const directory = `${ACCESS_RIGHTS_FIXTURES}${name}/`;

  return loaded(loadWorkspace({ reader: loadFsReader(directory), entry: "api.yaml" }), directory);
}

export function accessRightsApiOf(workspace: RawWorkspace, name?: string): RawApi {
  const api =
    name === undefined
      ? workspace.apis[0]
      : workspace.apis.find((candidate) => candidate.name === name);

  if (api === undefined) throw new Error(`the workspace has no api ${name ?? ""}`);

  return api;
}

/**
 * tree.schemas' service with the fixture's example check: params holding `DRAFT_FIXTURE_INVALID_EXAMPLE` do not
 * fit, until tree.schemas checks examples itself.
 */
export function accessRightsMarkerService(service: TreeSchemaService): TreeSchemaService {
  return {
    typeUse: (pointer, direction) => service.typeUse(pointer, direction),
    queryWire: (pointer) => service.queryWire(pointer),
    checkExample: (value) =>
      JSON.stringify(value).includes(DRAFT_FIXTURE_INVALID_EXAMPLE)
        ? [{ pointer: "", message: "the example holds the fixture's invalid marker" }]
        : [],
    checkTextExample: (text, use) => service.checkTextExample(text, use),
  };
}

export interface AccessRightsRun {
  readonly draft: DraftIR;
  readonly diagnostics: Diagnostic[];
}

/** Runs access.rights on `draft` with the guard on, as the orchestrator does. */
export function accessRightsRunOn(
  raw: RawApi,
  workspace: RawWorkspace,
  draft: DraftIR,
  treeSchemas: TreeSchemaService,
): AccessRightsRun {
  const diagnostics: Diagnostic[] = [];
  const context = pipelineContext({
    raw,
    workspace,
    report: (diagnostic) => diagnostics.push(diagnostic),
    guard: true,
  });
  const guarded = pipelineGuard(draft, accessRightsPass);

  try {
    accessRightsPass.run(guarded.draft, Object.freeze({ ...context, treeSchemas }));
  } finally {
    guarded.dispose();
  }

  return { draft, diagnostics };
}

/**
 * Runs tree.schemas, tree.nodes, access.identity, then access.rights (guarded) on the first api of `workspace`. tree.nodes does not
 * write `packs` yet, so the run records the packs the api loaded, in application order. `afterTree` changes
 * the draft before access.rights runs.
 */
export function accessRightsRunContract(
  workspace: RawWorkspace,
  afterTree?: (draft: DraftIR) => void,
): AccessRightsRun {
  const raw = accessRightsApiOf(workspace);
  const draft = createDraftIR();
  const diagnostics: Diagnostic[] = [];
  const context = pipelineContext({
    raw,
    workspace,
    report: (diagnostic) => diagnostics.push(diagnostic),
  });
  const service = treeSchemasPass.run(draft, context);
  const treeSchemas = accessRightsMarkerService(service);

  treeNodesPass.run(draft, Object.freeze({ ...context, treeSchemas }));

  if (diagnostics.length > 0)
    throw new Error(`the tree pass reports on the contract: ${JSON.stringify(diagnostics)}`);

  accessIdentityPass.run(draft, Object.freeze({ ...context, treeSchemas }));

  if (diagnostics.length > 0)
    throw new Error(`access.identity reports on the contract: ${JSON.stringify(diagnostics)}`);

  for (const layer of raw.layers)
    if (layer.layer.startsWith(PACK_LAYER))
      draft.packs.push({ name: layer.layer.slice(PACK_LAYER.length), version: PACK_VERSION });

  afterTree?.(draft);

  return accessRightsRunOn(raw, workspace, draft, treeSchemas);
}

const PACK_LAYER = "pack:";
const PACK_VERSION = "1.0.0";

/** The reference workspace, loaded once per test file. */
export function accessRightsReferenceWorkspace(): RawWorkspace {
  return loaded(
    loadWorkspace({ reader: loadFsReader(REFERENCE_CONTRACT), entry: "workspace.yaml" }),
    REFERENCE_CONTRACT,
  );
}

/** The after-tree draft of a reference api plus the access.identity members of its access delta. */
export function accessRightsReferenceDraft(api: DraftFixtureApi): DraftIR {
  const draft = draftFixture(api, "after-tree");

  for (const { half, members } of draftFixtureHalves(api, "access-delta"))
    if (half === "access.identity") draftFixtureApply(draft, members);

  return draft;
}

/** Runs access.rights on a reference api, from its fixture draft, with the fixture schema service. */
export function accessRightsRunReference(
  workspace: RawWorkspace,
  api: DraftFixtureApi,
): AccessRightsRun {
  return accessRightsRunOn(
    accessRightsApiOf(workspace, api),
    workspace,
    accessRightsReferenceDraft(api),
    draftFixtureSchemaService(api),
  );
}

/**
 * Runs the real access.identity, then access.rights, each guarded, on the after-tree draft of a reference api, with
 * the fixture schema service: both access halves as the orchestrator chains them.
 */
export function accessRightsRunReferenceHalves(
  workspace: RawWorkspace,
  api: DraftFixtureApi,
): AccessRightsRun {
  const raw = accessRightsApiOf(workspace, api);
  const draft = draftFixture(api, "after-tree");
  const treeSchemas = draftFixtureSchemaService(api);
  const diagnostics: Diagnostic[] = [];
  const context = pipelineContext({
    raw,
    workspace,
    report: (diagnostic) => diagnostics.push(diagnostic),
    guard: true,
  });
  const guarded = pipelineGuard(draft, accessIdentityPass);

  try {
    accessIdentityPass.run(guarded.draft, Object.freeze({ ...context, treeSchemas }));
  } finally {
    guarded.dispose();
  }

  const rights = accessRightsRunOn(raw, workspace, draft, treeSchemas);

  return { draft, diagnostics: [...diagnostics, ...rights.diagnostics] };
}
