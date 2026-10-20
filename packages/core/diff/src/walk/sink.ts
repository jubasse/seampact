import type { DiffBreak, DiffChange, DiffPosition, DiffRefusal } from "../result.js";
import { classifyCell, type DiffFact, type DiffKind } from "../table/rows.js";
import { compareText, scalarValue } from "./json.js";

// Collects the walk's changes: each raw change is classified once per reach (a position and the operations
// reaching it there), changes of one member at one position with one outcome are merged, and the result sorts the
// same way for the same pair of IRs.

/** A position and the operations that reach a member there, with the facts true for that reach. */
export interface ChangeReach {
  readonly position: DiffPosition;
  readonly operations: readonly string[];
  readonly facts?: readonly DiffFact[];
}

/** The part of an element's `Origin` the pack cause reads. */
export interface ElementOrigin {
  readonly layer: string;
}

export interface RawChange {
  readonly kind: DiffKind;
  readonly case: string;
  readonly pointer: string;
  readonly before?: unknown;
  readonly after?: unknown;
  /** The changed element's origin (in `after`, in `before` for a removal), read for the pack cause. */
  readonly origin?: ElementOrigin | undefined;
  readonly facts?: readonly DiffFact[];
}

const PACK_LAYER_PREFIX = "pack:";

const BREAK_ORDER: readonly DiffBreak[] = ["clients", "servers"];

export const NO_POSITION: readonly ChangeReach[] = [{ position: "none", operations: [] }];

export class ChangeSink {
  readonly #changes = new Map<string, DiffChange>();
  readonly #refusals: DiffRefusal[] = [];

  constructor(private readonly changedPacks: ReadonlySet<string>) {}

  emit(raw: RawChange, reaches: readonly ChangeReach[]): void {
    for (const reach of reaches) this.#emitAt(raw, reach);
  }

  refuse(refusal: DiffRefusal): void {
    this.#refusals.push(refusal);
  }

  get refusals(): readonly DiffRefusal[] {
    return this.#refusals;
  }

  /** The changes, sorted by first operation id, pointer, kind, case, position and breaks. */
  sortedChanges(): DiffChange[] {
    return [...this.#changes.values()].sort(compareChanges);
  }

  #emitAt(raw: RawChange, reach: ChangeReach): void {
    const facts = new Set([...(reach.facts ?? []), ...(raw.facts ?? [])]);
    const outcome = classifyCell(raw.kind, raw.case, reach.position, facts);
    const kind: DiffKind = outcome === undefined ? "unclassified" : raw.kind;
    const caseName = outcome === undefined ? `${raw.kind}.${raw.case}` : raw.case;
    const { breaks, classification } = outcome ?? {
      breaks: [...BREAK_ORDER],
      classification: "breaking",
    };
    // Reaches whose facts resolve the cell differently stay apart, so a break names only the operations it breaks.
    const key = [kind, caseName, raw.pointer, reach.position, classification, ...breaks].join(
      "\u0000",
    );
    const existing = this.#changes.get(key);

    if (existing !== undefined) {
      existing.operations = [...new Set([...existing.operations, ...reach.operations])].sort(
        compareText,
      );

      return;
    }

    const change: DiffChange = {
      kind,
      case: caseName,
      pointer: raw.pointer,
      position: reach.position,
      operations: [...new Set(reach.operations)].sort(compareText),
      breaks: [...breaks],
      classification,
    };
    const before = scalarValue(raw.before);
    const after = scalarValue(raw.after);
    const pack = this.#causePack(raw.origin);

    if (before !== undefined) change.before = before;

    if (after !== undefined) change.after = after;

    if (pack !== undefined) change.cause = { pack };

    this.#changes.set(key, change);
  }

  #causePack(origin: ElementOrigin | undefined): string | undefined {
    if (origin === undefined || !origin.layer.startsWith(PACK_LAYER_PREFIX)) return undefined;

    const pack = origin.layer.slice(PACK_LAYER_PREFIX.length);

    return this.changedPacks.has(pack) ? pack : undefined;
  }
}

function compareChanges(left: DiffChange, right: DiffChange): number {
  return (
    compareText(left.operations[0] ?? "", right.operations[0] ?? "") ||
    compareText(left.pointer, right.pointer) ||
    compareText(left.kind, right.kind) ||
    compareText(left.case, right.case) ||
    compareText(left.position, right.position) ||
    compareText(left.breaks.join(), right.breaks.join())
  );
}
