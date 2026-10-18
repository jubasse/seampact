import type { IrWriter } from "@seampact/spec/ir";

// The draft IR the passes read and write (ADR 0006 section 2), typed from the closed writer view of the IR
// (`IrWriter`, ADR 0004 section 13), so a pass can write no unknown union tag and no unknown open-enum value.
//
// Form (the lane's choice): the draft is the IR minus what finalize writes, with every catalogue and every list
// present from the start and every other member optional until its owner writes it.
// - The finalize members (`irVersion`, `irRevision`, `kinds`, `features`, and each operation's `features`) are
//   not in the draft: finalize computes them from the members present in the complete draft (ADR 0005).
// - Catalogues (every map member, `conventions` included) and `packs` and `operations` exist empty from the
//   start, so a half adds to a container that is always there and never races another half to create it.
// - `api` and `lint`, objects with no empty form, are optional until `tree.nodes` writes them; `api.wire` is
//   optional until derive.wire writes it.
// - Every member of an operation is optional: `tree.nodes` creates an operation with its own members and each
//   later half adds its own (field ownership, `ownership.ts`). tree.nodes creates `params` with its three lists
//   (`path`, `query`, `header`) and `responses` on every operation, empty when nothing is declared, so a later
//   half appends its derived elements to lists that are always there (the draft fixtures check it). Two shared objects keep the members another half
//   adds optional: `input.rawBody` (access.identity) and `input.bodyLimitBytes` (derive.wire), and
//   `concurrency.derivedFrom` (derive.wire). Everything else keeps the writer view's optionality.
// Finalize checks completeness: it validates the finished draft against the strict IR schema, which names every
// required member a half failed to write.

/** The request body of an operation in the draft: the members of later halves are optional. */
export type DraftOperationInput = Omit<IrWriter.OperationInput, "rawBody" | "bodyLimitBytes"> & {
  rawBody?: boolean;
  bodyLimitBytes?: number;
};

/** The concurrency of an operation in the draft: `derivedFrom` is written by derive.wire. */
export type DraftConcurrency = Omit<IrWriter.Concurrency, "derivedFrom"> & {
  derivedFrom?: IrWriter.DerivedFrom;
};

/** The operation member finalize writes; absent from a draft operation. */
export type DraftFinalizeOperationMember = "features";

type OperationMember = Exclude<
  keyof IrWriter.Operation,
  "input" | "concurrency" | DraftFinalizeOperationMember
>;

/** An operation in the draft: every member optional until its owner writes it, `features` absent. */
export type DraftOperation = { [K in OperationMember]?: IrWriter.Operation[K] } & {
  input?: DraftOperationInput;
  concurrency?: DraftConcurrency;
};

/** The api in the draft: `wire` is written by derive.wire, after tree.nodes writes the rest. */
export type DraftApi = Omit<IrWriter.Api, "wire"> & { wire?: IrWriter.ApiWire };

/** The members finalize writes; absent from the draft. */
export type DraftFinalizeMember = "irVersion" | "irRevision" | "kinds" | "features";

type DraftOptionalMember = "api" | "lint";

/** The draft IR of one api (ADR 0006 section 2). */
export type DraftIR = Omit<
  IrWriter.ContractIR,
  DraftFinalizeMember | DraftOptionalMember | "operations"
> & {
  api?: DraftApi;
  lint?: IrWriter.Lint;
  operations: DraftOperation[];
};

// A catalogue with no prototype: a right or a principal variant may be named `__proto__` (ADR 0004 section 13),
// and assigning that key on a plain object would set its prototype instead of adding an entry.
const catalogue = <V>(): Record<string, V> => Object.create(null) as Record<string, V>;

/** A new draft: every catalogue empty (without a prototype), `packs` and `operations` empty, nothing else. */
export function createDraftIR(): DraftIR {
  return {
    packs: [],
    conventions: catalogue(),
    formats: catalogue(),
    pagings: catalogue(),
    schemas: catalogue(),
    scalars: catalogue(),
    enums: catalogue(),
    errors: catalogue(),
    natures: catalogue(),
    schemes: catalogue(),
    headers: catalogue(),
    identities: catalogue(),
    rights: catalogue(),
    rules: catalogue(),
    scopes: catalogue(),
    buckets: catalogue(),
    services: catalogue(),
    extensionKeys: catalogue(),
    operations: [],
  };
}
