import type { IrWriter, Origin } from "@seampact/spec/ir";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { RawApi, RawWorkspace } from "../raw-tree.js";
import type { ResolvedConventions } from "./conventions.js";
import type { DraftIR } from "./draft.js";
import type { HalfName, PassOf } from "./halves.js";
import type { InheritedReader } from "./inherited.js";
import type { DraftField } from "./ownership.js";

// The pass interface of ADR 0006 section 2, with the halves made explicit: each pass is two halves, each half a
// `PassPart` that declares the draft fields it reads and writes. The guard (`guard.ts`) holds a half to its
// declaration in tests; the field-ownership table (`ownership.ts`) says which half may write each field.

/** A value no pass may change: the raw tree, the workspace, and the drafts of other apis. */
export type PassReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer E)[]
    ? readonly PassReadonly<E>[]
    : T extends object
      ? { readonly [K in keyof T]: PassReadonly<T[K]> }
      : T;

/** A problem an example has against a type use, located inside the example value. */
export interface TreeSchemaExampleIssue {
  /** The JSON Pointer of the offending value inside the example (`""` for the example itself). */
  pointer: string;
  message: string;
}

/**
 * What `tree.schemas` exposes to `tree.nodes`, which compiles routes, parameters and examples without compiling
 * schemas itself. Pointers are JSON Pointers into the api's merged raw tree (`RawApi.merged`). Each method is
 * pure: it reports nothing (tree.schemas reported every schema problem in its own run), and it answers
 * `undefined` where no schema is written or the schema written there was refused.
 */
export interface TreeSchemaService {
  /**
   * The type use the schema written at `pointer` compiles to, used in `direction` (a route's `input`, `output`,
   * a `responses.*.body`, a fields-map entry of `id`, `pathParams`, `query`, `headers`, an identity header or a
   * rule proof schema). An inline object, map or union is hoisted into `schemas` by tree.schemas, and the use
   * refers to it.
   */
  typeUse(pointer: string, direction: IrWriter.Direction): IrWriter.TypeUse | undefined;
  /** The query wire form of the query or form field whose schema is written at `pointer` (ADR 0002 section 7). */
  queryWire(pointer: string): IrWriter.QueryWire | undefined;
  /** Checks an example value against a use (FR-3); an empty list means the example fits. */
  checkExample(value: unknown, use: IrWriter.TypeUse): readonly TreeSchemaExampleIssue[];
}

/** What every half receives besides the draft (ADR 0006 section 2). */
export interface PassContext {
  /** The api's merged raw tree, its layers, origins and locations. */
  readonly raw: PassReadonly<RawApi>;
  readonly workspace: PassReadonly<RawWorkspace>;
  readonly conventions: ResolvedConventions;
  readonly inherited: InheritedReader;
  /** The origin of a node of the merged raw tree, from `RawApi.leafOrigins` and the layers. */
  origin(pointer: string): Origin | undefined;
  /**
   * The derived draft of a workspace api that already ran (relay order), or the IR of an import when the
   * `imports` option supplies one; undefined for an api neither knows.
   */
  relayed(api: string): PassReadonly<DraftIR> | undefined;
  report(diagnostic: Diagnostic): void;
}

/** The context of a half: `tree.nodes` also receives the schema service of `tree.schemas`. */
export type PassContextOf<H extends HalfName> = H extends "tree.nodes"
  ? PassContext & { readonly treeSchemas: TreeSchemaService }
  : PassContext;

/** What a half's run returns: `tree.schemas` hands its schema service to `tree.nodes`. */
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
  /** The IR of an import, when the `imports` option supplies one. */
  imported(api: string): PassReadonly<DraftIR> | undefined;
  report(diagnostic: Diagnostic): void;
}

/** The link pass: diagnostics only, over the derived draft of every api (ADR 0006 section 3). */
export interface WorkspacePass {
  name: "link";
  reads: readonly DraftField[];
  run(apis: ReadonlyMap<string, PassReadonly<DraftIR>>, context: WorkspacePassContext): void;
}
