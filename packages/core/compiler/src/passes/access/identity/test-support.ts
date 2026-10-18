import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IrWriter } from "@seampact/spec/ir";
import type { Diagnostic } from "../../../diagnostics/diagnostic.js";
import { type LoadReader, loadFsReader, loadWorkspace } from "../../../load/index.js";
import { loadMemoryReader } from "../../../load/reader.js";
import {
  createDraftIR,
  type DraftIR,
  pipelineContext,
  pipelineGuard,
  type TreeSchemaService,
} from "../../../pipeline/seam.js";
import type { RawApi, RawWorkspace } from "../../../raw-tree.js";
import { validateWorkspace } from "../../../validate/index.js";
import { treeNodesRun, treeNodesStubService } from "../../tree/nodes/test-support.js";
import { accessIdentityPass } from "./pass.js";

// Test support of the access.identity half, outside every barrel: the half run guarded (ADR 0006 section 2) on a
// contract checked by the load and validate stages, and, for the lane's own fixtures and inline contracts, a schema
// service answering a table of `{ pointer, direction, use }` rows, the row form of the reference contract's
// `<api>.schema-uses.json`, since `draftFixtureSchemaService` answers the reference contract's positions only. The
// rows stand for tree.schemas until its service lands.

const REFERENCE = fileURLToPath(
  new URL("../../../../../../../fixtures/reference/", import.meta.url),
);

export const ACCESS_IDENTITY_FIXTURES = fileURLToPath(
  new URL("../../../../../../../fixtures/passes/access-identity/", import.meta.url),
);

export interface AccessIdentityContract {
  workspace: RawWorkspace;
  raw: RawApi;
}

/** One row of a schema-use table: the use the service answers at a raw pointer in a direction. */
export interface AccessIdentitySchemaUseRow {
  pointer: string;
  direction: IrWriter.Direction;
  use: IrWriter.TypeUse;
}

function contractOf(reader: LoadReader, entry: string, api: string): AccessIdentityContract {
  const loaded = loadWorkspace({ reader, entry });

  if (loaded.diagnostics.length > 0)
    throw new Error(`the contract does not load: ${JSON.stringify(loaded.diagnostics)}`);

  const validated = validateWorkspace(loaded.workspace);
  const refused = [...validated.workspace, ...validated.apis.flatMap((item) => item.diagnostics)];

  if (refused.length > 0)
    throw new Error(`the contract does not validate: ${JSON.stringify(refused)}`);

  const raw = loaded.workspace.apis.find((candidate) => candidate.name === api);

  if (raw === undefined) throw new Error(`the contract has no api ${api}`);

  return { workspace: loaded.workspace, raw };
}

/** An api of the reference contract (`fixtures/reference`). */
export const accessIdentityReference = (api: string): AccessIdentityContract =>
  contractOf(loadFsReader(REFERENCE), "workspace.yaml", api);

/** The api of a lane fixture directory (`fixtures/passes/access-identity/<name>/api.yaml`). */
export const accessIdentityFixture = (name: string, api: string): AccessIdentityContract =>
  contractOf(loadFsReader(`${ACCESS_IDENTITY_FIXTURES}${name}`), "api.yaml", api);

/** A contract of one api file, written inline in a test. */
export const accessIdentityInline = (text: string, api = "a"): AccessIdentityContract =>
  contractOf(loadMemoryReader({ "api.yaml": text }), "api.yaml", api);

/** A JSON file of a lane fixture directory. */
export function accessIdentityFixtureJson(name: string, file: string): unknown {
  return JSON.parse(readFileSync(`${ACCESS_IDENTITY_FIXTURES}${name}/${file}`, "utf8"));
}

const TREE_POSITIONS = "/surfaces/";

/** A schema service answering the rows' positions and the query wires by field pointer (a copy each time). */
export function accessIdentityTableService(
  rows: readonly AccessIdentitySchemaUseRow[],
  queryWires: Readonly<Record<string, IrWriter.QueryWire>> = {},
): TreeSchemaService {
  const stub = treeNodesStubService({ queryWires });

  return {
    ...stub,
    typeUse: (pointer, direction) => {
      const found = rows.find((row) => row.pointer === pointer && row.direction === direction);

      if (found !== undefined) return structuredClone(found.use);

      // tree.nodes asks its route positions of the stub; an access.identity position answers its row only.
      return pointer.startsWith(TREE_POSITIONS) ? stub.typeUse(pointer, direction) : undefined;
    },
  };
}

/** The object schema tree.schemas would write for a principal with these fields (each a string or a ref). */
export function accessIdentityObjectSchema(
  id: string,
  fields: Record<string, IrWriter.TypeUse>,
): IrWriter.ObjectSchema {
  const origin = { layer: "api" as const, pointer: `/schemas/${id}` };

  return {
    kind: "object",
    id,
    name: { segments: [id.toLowerCase()], role: "schema" },
    directions: ["output"],
    examples: [],
    docs: {},
    extensions: {},
    origin,
    properties: Object.entries(fields).map(([name, type]) => ({
      name,
      type,
      optional: false,
      nullable: false,
      sensitive: false,
      deprecated: false,
      docs: {},
      extensions: {},
      origin: { layer: "api", pointer: `/schemas/${id}/properties/${name}` },
    })),
  };
}

/** A new draft holding these schemas, as tree.schemas leaves it. */
export function accessIdentityDraft(schemas: readonly IrWriter.KnownSchema[] = []): DraftIR {
  const draft = createDraftIR();

  for (const schema of schemas) draft.schemas[schema.id] = schema;

  return draft;
}

export interface AccessIdentityRun {
  draft: DraftIR;
  diagnostics: Diagnostic[];
}

/** Runs the half on `draft` with the guard on and read-only views, as a guarded pipeline run does. */
export function accessIdentityRun(
  contract: AccessIdentityContract,
  draft: DraftIR,
  treeSchemas: TreeSchemaService,
): AccessIdentityRun {
  const diagnostics: Diagnostic[] = [];
  const context = pipelineContext({
    raw: contract.raw,
    workspace: contract.workspace,
    report: (diagnostic) => diagnostics.push(diagnostic),
    guard: true,
  });

  const guard = pipelineGuard(draft, accessIdentityPass);

  try {
    accessIdentityPass.run(guard.draft, Object.freeze({ ...context, treeSchemas }));
  } finally {
    guard.dispose();
  }

  return { draft, diagnostics };
}

/**
 * Runs tree.nodes guarded, then `prepare` (which stands in for the members a later lane of tree.nodes writes, such
 * as params), then the half guarded, all on `draft` with the same schema service.
 */
export function accessIdentityRoutesRun(
  contract: AccessIdentityContract,
  draft: DraftIR,
  treeSchemas: TreeSchemaService,
  prepare: (draft: DraftIR) => void = () => {},
): AccessIdentityRun {
  const tree = treeNodesRun(contract.raw, contract.workspace, { treeSchemas, draft });

  if (tree.diagnostics.length > 0)
    throw new Error(`tree.nodes refused the test contract: ${JSON.stringify(tree.diagnostics)}`);

  prepare(draft);

  return accessIdentityRun(contract, draft, treeSchemas);
}

const STRING_USE: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };

const stringFields = (...names: string[]): Record<string, IrWriter.TypeUse> =>
  Object.fromEntries(names.map((name) => [name, STRING_USE]));

/** The principal schemas of the `catalogues` fixture, as tree.schemas writes them. */
export const ACCESS_IDENTITY_CATALOGUES_SCHEMAS: readonly IrWriter.ObjectSchema[] = [
  accessIdentityObjectSchema("ViewerPrincipal", stringFields("userId")),
  accessIdentityObjectSchema("DevicePrincipal", stringFields("deviceId")),
  accessIdentityObjectSchema("OperatorPrincipal", stringFields("operatorId", "rightsVersion")),
  accessIdentityObjectSchema("ServicePrincipal", stringFields("service")),
  accessIdentityObjectSchema("PartnerPrincipal", stringFields("partnerId")),
  accessIdentityObjectSchema("WebhookCaller", stringFields("account")),
];

const principalRow = (pointer: string, schema: string): AccessIdentitySchemaUseRow => ({
  pointer,
  direction: "output",
  use: { kind: "ref", schema },
});

/** The schema uses of the `catalogues` fixture: each principal, and the one header use schema. */
export const ACCESS_IDENTITY_CATALOGUES_USES: readonly AccessIdentitySchemaUseRow[] = [
  principalRow("/identities/viewer/principal", "ViewerPrincipal"),
  principalRow("/identities/viewer_or_device/principal/variants/viewer", "ViewerPrincipal"),
  principalRow("/identities/viewer_or_device/principal/variants/device", "DevicePrincipal"),
  principalRow("/identities/operator/principal", "OperatorPrincipal"),
  principalRow("/identities/service/principal", "ServicePrincipal"),
  principalRow("/identities/partner/principal", "PartnerPrincipal"),
  ...["stripe", "github", "clerk", "slack"].map((id) =>
    principalRow(`/identities/${id}/principal`, "WebhookCaller"),
  ),
  {
    pointer: "/identities/service/headers/actorSurface/schema",
    direction: "input",
    use: { kind: "enum", enum: "Surface" },
  },
];

/** The half run on the `catalogues` fixture. */
export const accessIdentityCataloguesRun = (): AccessIdentityRun =>
  accessIdentityRun(
    accessIdentityFixture("catalogues", "catalogues"),
    accessIdentityDraft(ACCESS_IDENTITY_CATALOGUES_SCHEMAS),
    accessIdentityTableService(ACCESS_IDENTITY_CATALOGUES_USES),
  );

/** The expected catalogues of the `catalogues` fixture (`catalogues.json`), keyed by catalogue. */
export function accessIdentityCataloguesExpected(catalogue: string): unknown {
  const expected = accessIdentityFixtureJson("catalogues", "catalogues.json");

  if (typeof expected !== "object" || expected === null || !Object.hasOwn(expected, catalogue))
    throw new Error(`catalogues.json has no ${catalogue}`);

  return Reflect.get(expected, catalogue);
}

/** The schemas of the `routes` fixture, as tree.schemas writes them. */
const ACCESS_IDENTITY_ROUTES_SCHEMAS: readonly IrWriter.ObjectSchema[] = [
  accessIdentityObjectSchema("ViewerPrincipal", stringFields("userId", "workspaceId")),
  accessIdentityObjectSchema("DevicePrincipal", stringFields("deviceId", "workspaceId")),
  accessIdentityObjectSchema("PartnerPrincipal", stringFields("partnerId")),
  accessIdentityObjectSchema("WebhookCaller", stringFields("account")),
  accessIdentityObjectSchema("Note", stringFields("workspaceId")),
  accessIdentityObjectSchema("Event", stringFields("type")),
  accessIdentityObjectSchema("SlashCommand", stringFields("command")),
];

const inputRow = (pointer: string, schema: string): AccessIdentitySchemaUseRow => ({
  pointer,
  direction: "input",
  use: { kind: "ref", schema },
});

/** The schema uses of the `routes` fixture: each principal and each declared input. */
const ACCESS_IDENTITY_ROUTES_USES: readonly AccessIdentitySchemaUseRow[] = [
  principalRow("/identities/viewer_or_device/principal/variants/viewer", "ViewerPrincipal"),
  principalRow("/identities/viewer_or_device/principal/variants/device", "DevicePrincipal"),
  principalRow("/identities/partner/principal", "PartnerPrincipal"),
  ...["stripe", "clerk", "slack"].map((id) =>
    principalRow(`/identities/${id}/principal`, "WebhookCaller"),
  ),
  inputRow("/surfaces/app/routes/notes/input", "Note"),
  inputRow("/surfaces/hooks/routes/stripe/input", "Event"),
  inputRow("/surfaces/hooks/routes/clerk/input", "Event"),
  inputRow("/surfaces/hooks/routes/slack/input", "SlashCommand"),
];

const TEXT_FIELD_WIRE: IrWriter.QueryWire = {
  kind: "text",
  style: "form",
  explode: true,
  brackets: false,
};

/** tree.nodes, then the half, run on the `routes` fixture. */
export const accessIdentityRoutesFixtureRun = (): AccessIdentityRun =>
  accessIdentityRoutesRun(
    accessIdentityFixture("routes", "routes"),
    accessIdentityDraft(ACCESS_IDENTITY_ROUTES_SCHEMAS),
    accessIdentityTableService(ACCESS_IDENTITY_ROUTES_USES, {
      "/schemas/SlashCommand/properties/command": TEXT_FIELD_WIRE,
    }),
  );
