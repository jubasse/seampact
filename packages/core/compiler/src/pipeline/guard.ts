import { createDraftIR, type DraftIR } from "./draft.js";
import type { HalfName } from "./halves.js";
import {
  type DraftField,
  draftElementOwner,
  draftFieldSegments,
  draftOwnerText,
  type OwnershipRow,
  pipelineContainers,
  pipelineOwnership,
} from "./ownership.js";
import { pipelineViewSource } from "./view.js";

// The read/write guard of ADR 0006 section 2: it wraps the draft for one half's run, so a half's tests fail on
// its first access outside its declaration instead of at merge time. Off by default in `compileWorkspace`, on
// with `guard: true`; every pass test turns it on. Finalize receives the unwrapped draft.
//
// Rules, for a half H:
// - A read of a value is allowed when a field H reads or writes is at or above it, or below it (navigating
//   through the containers above a declared field). Anything else throws `DraftAccessError`.
// - A write is allowed when a field H writes is at or above it, and for each row it changes (`ownership.ts`):
//   `owned`, H is the owner; `default`, H is in the order and the value is absent; `elements`, H owns the element
//   before and after the write (`declared` for an element without `derivedFrom`, else the wire owner of its
//   derivation). Writing a container (a new operation, `input`) writes each row below it, and only the rows
//   that change are checked, so `{ ...op.input, rawBody: true }` checks `rawBody` alone.
// - A default is written in one assignment: changing a member inside a present default is a write over it. A
//   default written where absent is one write even when rows sit below it (`input.schema` and its
//   `unknownKeys`); those sub-rows are checked by their own rows.
// - A half appends to an `elements` list; moving another half's element (`splice`, `unshift`, `sort`) writes it.
// - Values are unwrapped before they reach the draft, so the draft never holds a guard. A copy made to unwrap
//   keeps its source's prototype and defines its members. A read-only view (`view.ts`), at any depth of the value
//   written, throws: the half copies it first (`pipelineCopy`), as it must with the guard off too, where nothing
//   would catch the draft aliasing the raw tree or another api's draft.
// - The draft is data. A symbol key, an accessor, a prototype change or making a value non-extensible is
//   refused. `__proto__`, `constructor` and `prototype` read only as own members (a list's `constructor`
//   passes, for array methods), and writing a new member defines it, so no setter runs. A catalogue assigned
//   whole must have no prototype, as `createDraftIR` makes it, so an entry named `__proto__` stays an entry.
// - A frozen property reads as its own value, as a proxy must, so what it holds is not guarded.
// - The guards of a run are revocable: the orchestrator calls `dispose` when the half ends, so a guard kept past
//   the run throws instead of writing unchecked.
// The link pass is guarded with `writes: []`: read-only by guard as well as by type.
//
// Scope: the guard catches mistakes of our own pass lanes, not an adversary. One limit is accepted and not
// cloned away: a value read from one field and written to another is stored as the same object (aliasing), and
// a later write through either path is checked against that path only.

/** What a guarded part declares: its name, its reads and its writes. */
export interface GuardedPart {
  half: HalfName | "link";
  reads: readonly DraftField[];
  writes: readonly DraftField[];
}

/** A guarded draft for one half's run, and the call that ends it. */
export interface DraftGuard<D extends DraftIR> {
  /** The draft as the half sees it. */
  readonly draft: D;
  /**
   * Revokes every guard handed out for this run, so a guard the half kept past its run throws a `TypeError` on
   * any later access. The orchestrator calls it when the half ends; calling it again does nothing.
   */
  dispose(): void;
}

/** An access outside a half's declaration or its ownership. */
export class DraftAccessError extends Error {
  override readonly name = "DraftAccessError";
  constructor(
    readonly half: HalfName | "link",
    readonly access: "read" | "write",
    /** The concrete path: `operations[2].input.rawBody`. */
    readonly path: string,
    /** The normalised field: `operations[].input.rawBody`. */
    readonly field: string,
    /** The owner from the ownership table, in words. */
    readonly owner: string,
    reason: string,
  ) {
    super(
      `${half} ${access === "read" ? "read" : "wrote"} ${path}: ${reason} (field ${field}, owner ${owner})`,
    );
  }
}

interface TrieNode {
  row?: OwnershipRow;
  children: Map<string, TrieNode>;
}

const ROOT: TrieNode = buildTrie();

function buildTrie(): TrieNode {
  const root: TrieNode = { children: new Map() };
  const insert = (field: string): TrieNode => {
    let node = root;

    for (const segment of draftFieldSegments(field)) {
      let child = node.children.get(segment);

      if (child === undefined) {
        child = { children: new Map() };
        node.children.set(segment, child);
      }

      node = child;
    }

    return node;
  };

  for (const field of pipelineContainers) insert(field);

  for (const row of pipelineOwnership) insert(row.field).row = row;

  return root;
}

// Where a value sits: its concrete path, its normalised path, the trie node it matches (none below the deepest
// one), the row in force (the nearest row at or above it), and, inside an `elements` row, the element it is in.
interface Position {
  concrete: readonly (string | number)[];
  normal: readonly string[];
  node: TrieNode | undefined;
  row: { row: OwnershipRow; depth: number } | undefined;
  element: { list: unknown[]; index: number; depth: number } | undefined;
}

const START: Position = {
  concrete: [],
  normal: [],
  node: ROOT,
  row: undefined,
  element: undefined,
};

const isIndex = (target: object, key: string): boolean =>
  Array.isArray(target) && /^(0|[1-9][0-9]*)$/.test(key);

function child(position: Position, target: object, key: string): Position {
  const index = isIndex(target, key);
  const segment = index ? "[]" : key;
  const node = position.node?.children.get(segment);
  const normal = [...position.normal, segment];
  const concrete = [...position.concrete, index ? Number(key) : key];
  let row = position.row;
  let element = position.element;

  if (node?.row !== undefined) {
    row = { row: node.row, depth: normal.length };
    element = undefined;
  } else if (
    index &&
    row?.row.mode === "elements" &&
    row.depth === position.normal.length &&
    Array.isArray(target)
  ) {
    element = { list: target, index: Number(key), depth: normal.length };
  }

  return { concrete, normal, node, row, element };
}

const isPrefix = (prefix: readonly string[], path: readonly string[]): boolean =>
  prefix.length <= path.length && prefix.every((segment, i) => path[i] === segment);

function concreteText(path: readonly (string | number)[]): string {
  let text = "";

  for (const part of path) {
    if (typeof part === "number") text += `[${part}]`;
    else text += text === "" ? part : `.${part}`;
  }

  return text === "" ? "(the draft)" : text;
}

function normalText(path: readonly string[]): string {
  let text = "";

  for (const segment of path)
    text += segment === "[]" ? "[]" : text === "" ? segment : `.${segment}`;

  return text === "" ? "(the draft)" : text;
}

// Keys a runtime reads on any object (JSON.stringify, await, string conversion) that are no draft member.
const PASS_THROUGH = new Set(["toJSON", "then", "valueOf", "toString"]);

// Keys that reach a prototype when they are not an own member: read through a guard, they would hand out
// `Object.prototype` (or a constructor) wrapped as if it were draft data, and a write through it would reach
// every object. A list's `constructor` passes: array methods read it to build their result.
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

// The catalogues of the draft (`schemas`, `rights`, ...): the members `createDraftIR` creates without a prototype.
const CATALOGUES: ReadonlySet<string> = new Set(
  Object.entries(createDraftIR()).flatMap(([key, value]) =>
    isObject(value) && Object.getPrototypeOf(value) === null ? [key] : [],
  ),
);

// A data member as a plain assignment creates it.
const dataMember = (value: unknown): PropertyDescriptor => ({
  value,
  writable: true,
  enumerable: true,
  configurable: true,
});

/** Wraps `draft` so `part` may read and write only what it declares and owns, until `dispose`. */
export function pipelineGuard<D extends DraftIR>(draft: D, part: GuardedPart): DraftGuard<D> {
  const reads = [...part.reads, ...part.writes].map(draftFieldSegments);
  const writes = part.writes.map(draftFieldSegments);
  const proxies = new WeakMap<object, Map<string, object>>();
  const targets = new WeakMap<object, object>();
  const revokes: (() => void)[] = [];

  function fail(access: "read" | "write", position: Position, reason: string): never {
    throw new DraftAccessError(
      part.half,
      access,
      concreteText(position.concrete),
      normalText(position.row ? position.normal.slice(0, position.row.depth) : position.normal),
      draftOwnerText(position.row?.row),
      reason,
    );
  }

  const readable = (position: Position): boolean =>
    reads.some((field) => isPrefix(field, position.normal) || isPrefix(position.normal, field));

  // The position of `target[key]`, checked as a read; undefined for a key that is no draft member.
  const read = (position: Position, target: object, key: string | symbol): Position | undefined => {
    if (typeof key === "symbol") return undefined;

    if (Array.isArray(target) && !isIndex(target, key)) return undefined;
    const next = child(position, target, key);

    if (PASS_THROUGH.has(key) && next.node === undefined && !Object.hasOwn(target, key))
      return undefined;

    if (!readable(next)) fail("read", next, "outside its reads and writes");

    return next;
  };

  // One guard per target and concrete path, so a trap always knows where its target sits.
  const wrap = (value: unknown, position: Position): unknown => {
    if (!isObject(value)) return value;
    const key = JSON.stringify(position.concrete);
    let byPath = proxies.get(value);

    if (byPath === undefined) {
      byPath = new Map();
      proxies.set(value, byPath);
    }

    let proxy = byPath.get(key);

    if (proxy === undefined) {
      const revocable = Proxy.revocable(value, handlerAt(position));

      proxy = revocable.proxy;
      revokes.push(revocable.revoke);
      byPath.set(key, proxy);
      targets.set(proxy, value);
    }

    return proxy;
  };

  // The value without any guard inside it, copying only the objects and lists that held one. A copy keeps the
  // prototype of its source (none for a catalogue) and defines its members, so a member named `__proto__` stays
  // a member instead of setting the copy's prototype. `at` is where the value is written, for a refusal.
  const unwrap = (value: unknown, at: Position): unknown => {
    if (!isObject(value)) return value;
    const target = targets.get(value);

    if (target !== undefined) return target;
    // A read-only view (of the raw tree, another api's draft or an import) is refused rather than copied: the
    // guard is off outside tests, so a copy made here would hide a draft that aliases what it was read from.
    const source = pipelineViewSource(value);

    if (source !== undefined)
      fail(
        "write",
        at,
        `a read-only view of ${source} is stored as is: copy it first: pipelineCopy(value)`,
      );
    const inside = (item: unknown): unknown => unwrap(item, at);

    if (Array.isArray(value)) {
      const items = value.map(inside);

      return items.some((item, i) => item !== value[i]) ? items : value;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) return value;
    const members = Object.entries(value);
    const plain = members.map(([, item]) => inside(item));

    if (plain.every((item, i) => item === members[i]?.[1])) return value;
    const copy: object = Object.create(prototype);

    for (const [i, [member]] of members.entries())
      Object.defineProperty(copy, member, dataMember(plain[i]));

    return copy;
  };

  const declaredWrite = (position: Position): void => {
    if (!writes.some((field) => isPrefix(field, position.normal)))
      fail("write", position, "outside its writes");
  };

  // Writing `next` over `previous` at `position`: checks each row the write changes.
  const checkWrite = (position: Position, next: unknown, previous: unknown): void => {
    if (next === previous) return;
    const row = position.row?.row;
    const element = position.element;

    if (row?.mode === "elements" && element?.depth === position.normal.length) {
      declaredWrite(position);
      owns(position, row, previous, "before");
      owns(position, row, next, "after");

      // The element's own sub-rows (a response's `headers`) have their own owners.
      for (const [segment] of position.node?.children ?? []) {
        const below = child(position, isObject(next) ? next : {}, segment);

        checkWrite(below, member(next, segment), member(previous, segment));
      }

      return;
    }

    const hasRowsBelow = position.node !== undefined && position.node.children.size > 0;
    // A default with rows below it (`input.schema` and its `unknownKeys`), written where absent: one write of the
    // default, and only its sub-rows checked on their own. A present default is not taken here, so changing a
    // member inside it still reaches `checkRow` as a write over it.
    const atDefault =
      position.row?.row.mode === "default" && position.row.depth === position.normal.length;

    if (atDefault && hasRowsBelow && previous === undefined && isObject(next)) {
      checkRow(position, next, undefined);

      for (const [segment] of position.node?.children ?? [])
        checkWrite(child(position, next, segment), member(next, segment), undefined);

      return;
    }

    if (!hasRowsBelow || (!isObject(next) && !isObject(previous))) {
      checkRow(position, next, previous);

      return;
    }

    const holder = isObject(next) ? next : (previous as object);

    for (const key of memberKeys(next, previous)) {
      const below = child(position, holder, key);

      if (below.node === undefined && position.row === undefined)
        fail("write", below, "no row owns this member");
      checkWrite(below, member(next, key), member(previous, key));
    }
  };

  const checkRow = (position: Position, next: unknown, previous: unknown): void => {
    const rowAt = position.row;

    if (rowAt === undefined) fail("write", position, "no row owns this member");
    declaredWrite(position);
    const row = rowAt.row;

    switch (row.mode) {
      case "owned":
        if (row.owner !== part.half) fail("write", position, `owned by ${row.owner}`);

        return;
      case "default":
        if (!row.order.some((half) => half === part.half))
          fail("write", position, `a default written by ${row.order.join(", ")} only`);

        if (rowAt.depth !== position.normal.length || previous !== undefined)
          fail("write", position, "a default is written only where absent, and a value is present");

        return;
      case "elements":
        checkElements(position, row, rowAt.depth, next, previous);

        return;
    }
  };

  const owns = (
    position: Position,
    row: Extract<OwnershipRow, { mode: "elements" }>,
    element: unknown,
    when: "before" | "after",
  ): void => {
    if (element === undefined) return;
    const { owner, derivation } = draftElementOwner(row, element);

    if (derivation !== undefined && owner !== undefined && !row.derived.includes(owner))
      fail(
        "write",
        position,
        `derivation ${derivation} adds no element here (derived by ${row.derived.join(", ")})`,
      );

    if (owner === part.half) return;
    const by = derivation === undefined ? "declared" : `derivation ${derivation}`;

    fail(
      "write",
      position,
      owner === undefined
        ? `the element ${when} the write has no owner (${by})`
        : `the element ${when} the write is owned by ${owner} (${by})`,
    );
  };

  const checkElements = (
    position: Position,
    row: Extract<OwnershipRow, { mode: "elements" }>,
    depth: number,
    next: unknown,
    previous: unknown,
  ): void => {
    if (position.normal.length === depth) {
      // The whole list: every element that changes is the half's, before and after.
      const before = Array.isArray(previous) ? previous : [];
      const after = Array.isArray(next) ? next : [];

      for (let i = 0; i < Math.max(before.length, after.length); i++) {
        if (before[i] === after[i]) continue;
        owns(position, row, before[i], "before");
        owns(position, row, after[i], "after");
      }

      return;
    }

    const element = position.element;

    if (element === undefined) fail("write", position, "outside any element");
    const current: unknown = element.list[element.index];

    owns(position, row, current, "before");
    // A write inside the element that changes its derivation changes its owner.
    const inside = position.normal.slice(element.depth);

    if (inside[0] !== "derivedFrom" || !isObject(current)) return;
    const derivedFrom = member(current, "derivedFrom");

    if (inside.length === 1) owns(position, row, { derivedFrom: next }, "after");
    else if (inside.length === 2 && inside[1] === "derivation")
      owns(
        position,
        row,
        { derivedFrom: { ...(isObject(derivedFrom) ? derivedFrom : {}), derivation: next } },
        "after",
      );
  };

  const write = (position: Position, target: object, key: string, value: unknown): void => {
    const next = child(position, target, key);

    if (next.node === undefined && position.row === undefined)
      fail("write", next, "no row owns this member");
    checkWrite(next, value, member(target, key));
  };

  // Checks writing `value` (undefined for a delete) at `target[key]`, and returns the value to store.
  const assign = (
    position: Position,
    target: object,
    key: string | symbol,
    value: unknown,
  ): unknown => {
    if (typeof key === "symbol")
      fail("write", position, `a symbol key (${String(key)}) is no draft member`);
    const plain = unwrap(value, child(position, target, key));

    if (Array.isArray(target) && key === "length") {
      // Coerced first, as the array coerces it, so `length = "0"` is checked as the truncation it is. An invalid
      // length changes nothing: storing it throws a RangeError.
      const length = Number(plain);

      if (Number.isInteger(length) && length >= 0)
        checkWrite(position, target.slice(0, length), target.slice());

      return length;
    }

    if (
      position.normal.length === 0 &&
      CATALOGUES.has(key) &&
      !(isObject(plain) && !Array.isArray(plain) && Object.getPrototypeOf(plain) === null)
    )
      // Refused rather than re-copied: the guard is off outside tests, so a copy here would hide the bug.
      fail(
        "write",
        child(position, target, key),
        "a catalogue is always present, as an object without a prototype (Object.create(null)), " +
          "so an entry named __proto__ stays an entry",
      );
    write(position, target, key, plain);

    return plain;
  };

  const handlerAt = (position: Position): ProxyHandler<object> => ({
    get(target, key, receiver) {
      if (
        typeof key === "string" &&
        PROTOTYPE_KEYS.has(key) &&
        !Object.hasOwn(target, key) &&
        !(Array.isArray(target) && key === "constructor")
      )
        fail("read", child(position, target, key), "a prototype key, not an own member");
      const next = read(position, target, key);
      const value: unknown = Reflect.get(target, key, receiver);

      if (next === undefined) return value;
      // A frozen property must read as its own value (a proxy invariant), so its value leaves unguarded.
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);

      if (descriptor?.configurable === false && descriptor.writable === false) return value;

      return wrap(value, next);
    },
    has(target, key) {
      read(position, target, key);

      return Reflect.has(target, key);
    },
    getOwnPropertyDescriptor(target, key) {
      const next = read(position, target, key);
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);

      if (next === undefined || descriptor === undefined || !descriptor.configurable)
        return descriptor;

      return "value" in descriptor
        ? { ...descriptor, value: wrap(descriptor.value, next) }
        : descriptor;
    },
    ownKeys(target) {
      if (!readable(position)) fail("read", position, "outside its reads and writes");

      return Reflect.ownKeys(target);
    },
    set(target, key, value) {
      const plain = assign(position, target, key, value);

      // A new member is defined, so no setter up the prototype chain runs (`__proto__` included).
      return Object.hasOwn(target, key)
        ? Reflect.set(target, key, plain)
        : Reflect.defineProperty(target, key, dataMember(plain));
    },
    deleteProperty(target, key) {
      assign(position, target, key, undefined);

      return Reflect.deleteProperty(target, key);
    },
    defineProperty(target, key, descriptor) {
      // The draft is data: a getter or a setter would run code on every later read or write, unchecked.
      if ("get" in descriptor || "set" in descriptor)
        fail("write", position, `an accessor for ${String(key)} is no draft member`);
      const plain = assign(position, target, key, descriptor.value);

      return Reflect.defineProperty(target, key, { ...descriptor, value: plain });
    },
    setPrototypeOf() {
      return fail("write", position, "a draft value keeps its prototype");
    },
    preventExtensions() {
      return fail(
        "write",
        position,
        "a draft value stays extensible for the halves after this one",
      );
    },
  });

  return {
    draft: wrap(draft, START) as D,
    dispose() {
      for (const revoke of revokes.splice(0)) revoke();
    },
  };
}

const member = (value: unknown, key: string): unknown =>
  isObject(value) && Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined;

// The members of either value; for lists, every index of either.
function memberKeys(next: unknown, previous: unknown): string[] {
  const keys = new Set<string>();

  for (const value of [next, previous]) {
    if (!isObject(value)) continue;

    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) keys.add(String(i));
    else for (const key of Object.keys(value)) keys.add(key);
  }

  return [...keys];
}
