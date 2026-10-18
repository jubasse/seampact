import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IrWriter } from "@seampact/spec/ir";
import { derivationRowOf } from "../../../derivations/table.js";
import type { Diagnostic } from "../../../diagnostics/diagnostic.js";
import { loadFsReader, loadWorkspace } from "../../../load/index.js";
import { loadMemoryReader } from "../../../load/reader.js";
import {
  type DraftFixtureApi,
  draftFixture,
  draftFixtureSchemaService,
} from "../../../pipeline/draft-fixture.js";
import {
  createDraftIR,
  type DraftIR,
  type PassPart,
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
import { deriveWirePass } from "./pass.js";

// Test support of derive.wire, outside the barrel: inline contracts and lane fixtures run through the tree and
// access halves, the reference contract from its after-access fixture draft, and a guarded run of the half.

const FIXTURES = fileURLToPath(new URL("../../../../../../../fixtures/", import.meta.url));

/** The directory of this lane's fixtures. */
export const DERIVE_WIRE_FIXTURES = `${FIXTURES}passes/derive-wire/`;

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
export function deriveWireLoadFiles(files: Record<string, string>): RawWorkspace {
  return loaded(
    loadWorkspace({ reader: loadMemoryReader(files), entry: "api.yaml" }),
    "the inline contract",
  );
}

/** A workspace from a directory of this lane's fixtures, its entry `api.yaml`. */
export function deriveWireLoadFixture(name: string): RawWorkspace {
  const directory = `${DERIVE_WIRE_FIXTURES}${name}/`;

  return loaded(loadWorkspace({ reader: loadFsReader(directory), entry: "api.yaml" }), directory);
}

/**
 * A lane fixture's `api.yaml` with each `[from, to]` text replaced once, loaded as an inline contract: a variant
 * of a fixture for one test. A `from` the file does not hold throws.
 */
export function deriveWireFixtureVariant(
  name: string,
  replacements: readonly (readonly [string, string])[],
): RawWorkspace {
  let text = readFileSync(`${DERIVE_WIRE_FIXTURES}${name}/api.yaml`, "utf8");

  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`the ${name} fixture holds no '${from}'`);
    text = text.replace(from, to);
  }

  return deriveWireLoadFiles({ "api.yaml": text });
}

/** A JSON file of a lane fixture directory. */
export function deriveWireFixtureJson(name: string, file: string): unknown {
  return JSON.parse(readFileSync(`${DERIVE_WIRE_FIXTURES}${name}/${file}`, "utf8"));
}

/**
 * The reference workspace with each `[from, to]` text of one of its files replaced once, loaded from memory: a
 * variant of the reference for one test. A `from` the file does not hold throws.
 */
export function deriveWireReferenceVariant(
  file: string,
  replacements: readonly (readonly [string, string])[],
): RawWorkspace {
  return deriveWireReferenceVariants({ [file]: replacements });
}

/** The reference workspace with the `[from, to]` texts of each named file replaced once, as `deriveWireReferenceVariant`. */
export function deriveWireReferenceVariants(
  replacementsByFile: Readonly<Record<string, readonly (readonly [string, string])[]>>,
): RawWorkspace {
  const files: Record<string, string> = {};

  for (const entry of readdirSync(REFERENCE_CONTRACT, { recursive: true, withFileTypes: true }))
    if (entry.isFile()) {
      const path = `${entry.parentPath}/${entry.name}`.slice(REFERENCE_CONTRACT.length);

      files[path] = readFileSync(`${REFERENCE_CONTRACT}${path}`, "utf8");
    }

  for (const [file, replacements] of Object.entries(replacementsByFile)) {
    let text = files[file];

    if (text === undefined) throw new Error(`the reference holds no file ${file}`);

    for (const [from, to] of replacements) {
      if (!text.includes(from)) throw new Error(`the reference ${file} holds no '${from}'`);
      text = text.replace(from, to);
    }

    files[file] = text;
  }

  return loaded(
    loadWorkspace({ reader: loadMemoryReader(files), entry: "workspace.yaml" }),
    `the reference variant of ${Object.keys(replacementsByFile).join(", ")}`,
  );
}

/** The reference workspace. */
export function deriveWireReferenceWorkspace(): RawWorkspace {
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

export interface DeriveWireRun {
  readonly draft: DraftIR;
  readonly diagnostics: Diagnostic[];
}

/** Runs derive.wire, or `part` standing for it, on `draft` with the guard on, as the orchestrator does. */
export function deriveWireRunOn(
  raw: RawApi,
  workspace: RawWorkspace,
  draft: DraftIR,
  treeSchemas: TreeSchemaService,
  part: PassPart<"derive.wire"> = deriveWirePass,
  relayed?: ReadonlyMap<string, DraftIR>,
): DeriveWireRun {
  const diagnostics: Diagnostic[] = [];
  const context = Object.freeze({
    ...pipelineContext({
      raw,
      workspace,
      report: (diagnostic) => diagnostics.push(diagnostic),
      guard: true,
      ...(relayed === undefined ? {} : { relayed }),
    }),
    treeSchemas,
  });
  const guarded = pipelineGuard(draft, part);

  try {
    part.run(guarded.draft, context);
  } finally {
    guarded.dispose();
  }

  return { draft, diagnostics };
}

/** Runs the tree and access halves, then derive.wire (guarded), on the named or first api of `workspace`; `relayed` holds the drafts its relay routes copy from. */
export function deriveWireRunContract(
  workspace: RawWorkspace,
  api?: string,
  relayed?: ReadonlyMap<string, DraftIR>,
): DeriveWireRun {
  const raw = apiOf(workspace, api);
  const draft = createDraftIR();
  const diagnostics: Diagnostic[] = [];
  const context = pipelineContext({
    raw,
    workspace,
    report: (diagnostic) => diagnostics.push(diagnostic),
    ...(relayed === undefined ? {} : { relayed }),
  });
  const treeSchemas = treeSchemasPass.run(draft, context);
  const later = Object.freeze({ ...context, treeSchemas });

  for (const half of [treeNodesPass, accessIdentityPass, accessRightsPass]) {
    half.run(draft, later);

    if (diagnostics.length > 0)
      throw new Error(`${half.half} reports on the contract: ${JSON.stringify(diagnostics)}`);
  }

  return deriveWireRunOn(raw, workspace, draft, treeSchemas, deriveWirePass, relayed);
}

/**
 * Runs derive.wire, or `part` standing for it, (guarded) on the after-access fixture draft of a reference api; a
 * relay route of tasksService reads the after-access draft of tasks.
 */
export function deriveWireRunReference(
  workspace: RawWorkspace,
  api: DraftFixtureApi,
  part: PassPart<"derive.wire"> = deriveWirePass,
): DeriveWireRun {
  return deriveWireRunOn(
    apiOf(workspace, api),
    workspace,
    draftFixture(api, "after-access"),
    draftFixtureSchemaService(api),
    part,
    new Map([["tasks", draftFixture("tasks", "after-access")]]),
  );
}

/** A diagnostic as the tests compare it: its rule and where it is located. */
export const deriveWireLocated = (
  diagnostic: Diagnostic,
): { rule: string; pointer: string; related: string[] } => ({
  rule: diagnostic.rule,
  pointer: diagnostic.origin.pointer,
  related: diagnostic.related.map((item) => item.origin.pointer),
});

const isDeriveWireElement = (element: { derivedFrom?: IrWriter.DerivedFrom }): boolean =>
  element.derivedFrom !== undefined &&
  derivationRowOf(element.derivedFrom.derivation)?.wire === "derive.wire";

/**
 * The members derive.wire wrote, by operation id: its derived parameters, responses and response headers (by
 * status), the input's body limit and derived unknown-key policy, `idempotency`, `deadlineHeader`,
 * `concurrency.derivedFrom`, `cache` and a derived `maturity`. An operation with none is left out.
 */
export function deriveWireMembers(draft: DraftIR): Record<string, Record<string, unknown>> {
  const members: Record<string, Record<string, unknown>> = {};

  for (const operation of draft.operations) {
    const written: Record<string, unknown> = {};
    const header = operation.params?.header.filter(isDeriveWireElement) ?? [];
    const query = operation.params?.query.filter(isDeriveWireElement) ?? [];
    // A derived response is listed whole, a declared one by its derived headers.
    const responses = (operation.responses ?? []).flatMap((response) => {
      if (isDeriveWireElement(response)) return [response];

      const headers = response.headers.filter(isDeriveWireElement);

      return headers.length > 0 ? [{ status: response.status, headers }] : [];
    });
    const input = operation.input;
    const unknownKeys = input?.schema.kind === "ref" ? input.schema.unknownKeys : undefined;

    if (header.length > 0 || query.length > 0)
      written.params = {
        ...(header.length > 0 ? { header } : {}),
        ...(query.length > 0 ? { query } : {}),
      };

    if (responses.length > 0) written.responses = responses;

    if (input?.bodyLimitBytes !== undefined) written.bodyLimitBytes = input.bodyLimitBytes;

    if (unknownKeys?.derivedFrom?.derivation === "input.unknownKeys")
      written.unknownKeys = unknownKeys;

    if (operation.idempotency !== undefined) written.idempotency = operation.idempotency;

    if (operation.deadlineHeader !== undefined) written.deadlineHeader = operation.deadlineHeader;

    if (operation.concurrency?.derivedFrom !== undefined)
      written.concurrency = { derivedFrom: operation.concurrency.derivedFrom };

    if (operation.cache !== undefined) written.cache = operation.cache;

    if (operation.maturity !== undefined && operation.maturity.source !== "stated")
      written.maturity = operation.maturity;

    if (Object.keys(written).length > 0 && operation.id !== undefined)
      members[operation.id] = written;
  }

  return members;
}

/** The operation of a run by id; a missing one throws. */
export function deriveWireOperation(run: DeriveWireRun, id: string): DraftIR["operations"][number] {
  const operation = run.draft.operations.find((candidate) => candidate.id === id);

  if (operation === undefined) throw new Error(`the run has no operation ${id}`);

  return operation;
}

/** The derived header parameters of an operation as `[name, required, derivation]`. */
export function deriveWireDerivedHeaders(
  run: DeriveWireRun,
  id: string,
): [string, boolean, string | undefined][] {
  return (deriveWireOperation(run, id).params?.header ?? [])
    .filter((param) => param.derivedFrom !== undefined)
    .map((param) => [param.name, param.required, param.derivedFrom?.derivation]);
}

/** The response header names of an operation, by status. */
export function deriveWireResponseHeaders(
  run: DeriveWireRun,
  id: string,
): Record<number, string[]> {
  return Object.fromEntries(
    (deriveWireOperation(run, id).responses ?? []).map((response) => [
      response.status,
      response.headers.map((header) => header.name),
    ]),
  );
}
