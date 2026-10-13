import type { ContractIR, IrWriter, Origin } from "@seampact/spec/ir";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { RawApi, RawWorkspace } from "../raw-tree.js";
import type { ResolvedConventions } from "./conventions.js";
import type { DraftIR } from "./draft.js";
import type { HalfName, PassOf } from "./halves.js";
import type { InheritedReader } from "./inherited.js";
import type { PassReadonly } from "./readonly.js";
import type { DraftField } from "./ownership.js";

// The pass interface of ADR 0006 section 2, with the halves made explicit: each pass is two halves, each half a
// `PassPart` that declares the draft fields it reads and writes. The guard (`guard.ts`) holds a half to its
// declaration in tests; the field-ownership table (`ownership.ts`) says which half may write each field.

/** A problem an example has against a type use, located inside the example value. */
export interface TreeSchemaExampleIssue {
  /** The JSON Pointer of the offending value inside the example (`""` for the example itself). */
  pointer: string;
  message: string;
}

/**
 * What `tree.schemas` exposes to every later half (ADR 0006 section 2): `tree.nodes` compiles routes, parameters
 * and examples with it without compiling schemas itself, and access and derive read type uses through it.
 * `tree.schemas` returns it from its run (`PassResultOf`); the orchestrator hands it to each later half as
 * `context.treeSchemas`. Pointers are JSON Pointers into the api's merged raw tree (`RawApi.merged`).
 * - Every hoist happens during tree.schemas' run: each inline object, map or union of the raw tree is in
 *   `schemas` before the service is returned. The service never writes the draft and keeps no reference to the
 *   draft handed to the run: with the guard on, that draft is revoked when the run ends.
 * - Each method is pure and reports nothing: tree.schemas reported every schema problem in its own run.
 * - `undefined` means no schema is written at `pointer` (or `pointer` is no schema position). A refused schema
 *   never reaches a later half: they run only when tree.schemas reported no error (the stop rule).
 */
export interface TreeSchemaService {
  /**
   * The type use the schema written at `pointer` compiles to, used in `direction`. An inline object, map or
   * union refers to the schema tree.schemas hoisted for it. The positions, each with its direction (ADR 0003
   * section 4):
   * - input: a route's `input`, a fields-map entry of `id` (the member path parameter), `pathParams`, `query` or
   *   request `headers`, a form or multipart field, the batch ids input (at the `batch` op entry,
   *   `.../ops/batch`), right and rule `params`, a scope's `id` and a resource subject's `id`, a rule proof schema
   *   (`/rules/<id>/proof/schema`);
   * - output: a route's `output` and `item`, a `responses.*.body`, an identity's `principal` and each of its
   *   `variants`, error `params`;
   * - a header declaration's `schema` and an identity header use's `schema`: the declaration's `in` (`request`
   *   input, `response` output); a `versionToken` declaration (no `in`, a response and a request name) is input
   *   and output, and a use's `for` sets no direction;
   * - a declaration of the `schemas` catalogue: the direction of the use that names it;
   * - a schema a relay route copies: the direction of the public operation's use.
   */
  typeUse(pointer: string, direction: IrWriter.Direction): IrWriter.TypeUse | undefined;
  /**
   * The query wire form of the query or form field at `pointer` (ADR 0002 section 7): a query field, or a form or
   * multipart field keyed by its position in the input schema, not by its origin: `/schemas/<id>/properties/<field>`
   * for a declared schema, `<route>/input/properties/<field>` for an inline input, the same for a derived property
   * (the concurrency version property) or one a schema takes from another layer or schema; also a rule proof
   * schema (`/rules/<id>/proof/schema`), the `wire` a form or multipart proof of that type gets.
   */
  queryWire(pointer: string): IrWriter.QueryWire | undefined;
  /** Checks an example value against a use (FR-3); an empty list means the example fits. */
  checkExample(value: unknown, use: IrWriter.TypeUse): readonly TreeSchemaExampleIssue[];
}

/**
 * What every half receives besides the draft (ADR 0006 section 2). A half copies what it stores in its draft from
 * `raw`, `workspace`, `relayed`, `imported` or an `inherited` entry (`pipelineCopy`), with the guard on or off:
 * the draft never aliases what a half reads. Everything read from `raw` counts, tree-node settings and written
 * convention readings (`conventions.get`) included. With the guard on, storing a read-only view throws; with it
 * off, nothing would catch a later change through the draft reaching the raw tree or another api's draft.
 */
export interface PassContext {
  /** The api's merged raw tree, its layers, origins and locations. */
  readonly raw: PassReadonly<RawApi>;
  readonly workspace: PassReadonly<RawWorkspace>;
  readonly conventions: ResolvedConventions;
  readonly inherited: InheritedReader;
  /** The origin of a node of the merged raw tree, from `RawApi.leafOrigins` and the layers. */
  origin(pointer: string): Origin | undefined;
  /**
   * The derived draft of a workspace api that already ran (relay order), in the closed writer view; undefined
   * for an api of no workspace or one that has not run.
   */
  relayed(api: string): PassReadonly<DraftIR> | undefined;
  /**
   * The IR of an imported api, when the `imports` option supplies one, in the open reader types: an IR from
   * another compiler version may hold a variant or a value this one does not know. Code that copies from it into
   * the draft narrows each union with `isKnownVariant` and reports an unknown arm by name instead of copying it.
   */
  imported(api: string): PassReadonly<ContractIR> | undefined;
  report(diagnostic: Diagnostic): void;
}

/** The context of a half: every half after `tree.schemas` also receives its schema service. */
export type PassContextOf<H extends HalfName> = H extends "tree.schemas"
  ? PassContext
  : PassContext & { readonly treeSchemas: TreeSchemaService };

/** What a half's run returns: `tree.schemas` hands its schema service to every later half. */
export type PassResultOf<H extends HalfName> = H extends "tree.schemas"
  ? TreeSchemaService
  : undefined;

/** One half of a pass (ADR 0006 section 2). */
export interface PassPart<H extends HalfName = HalfName> {
  pass: PassOf<H>;
  half: H;
  /** The draft fields the half reads; a field it writes is readable without being listed. */
  reads: readonly DraftField[];
  writes: readonly DraftField[];
  run(draft: DraftIR, context: PassContextOf<H>): PassResultOf<H>;
}

/** The six halves, one part each, as the orchestrator receives them. */
export type PassParts = { readonly [H in HalfName]: PassPart<H> };

/** The context of the link pass: the whole workspace, no single api. */
export interface WorkspacePassContext {
  readonly workspace: PassReadonly<RawWorkspace>;
  /** The IR of an import, when the `imports` option supplies one, in the open reader types. */
  imported(api: string): PassReadonly<ContractIR> | undefined;
  /**
   * Reports a diagnostic under the workspace api whose side table locates its origin (the relay route's api for a
   * `relays` superset failure); an api name outside the workspace throws.
   */
  report(api: string, diagnostic: Diagnostic): void;
}

/** The link pass: diagnostics only, over the derived draft of every api (ADR 0006 section 3). */
export interface WorkspacePass {
  name: "link";
  reads: readonly DraftField[];
  run(apis: ReadonlyMap<string, PassReadonly<DraftIR>>, context: WorkspacePassContext): void;
}
