import type { DraftIR } from "./draft.js";
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
// - A default is written in one assignment: changing a member inside a present default is a write over it.
// - A half appends to an `elements` list; moving another half's element (`splice`, `unshift`, `sort`) writes it.
// - Values are unwrapped before they reach the draft, so the draft never holds a guard.
// The link pass is guarded with `writes: []`: read-only by guard as well as by type.

/** What a guarded part declares: its name, its reads and its writes. */
export interface GuardedPart {
  half: HalfName | "link";
  reads: readonly DraftField[];
  writes: readonly DraftField[];
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
const PASS_THROUGH = new Set(["toJSON", "then", "constructor", "valueOf", "toString"]);

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

/** Wraps `draft` so `part` may read and write only what it declares and owns. */
export function pipelineGuard<D extends DraftIR>(draft: D, part: GuardedPart): D {
  const reads = [...part.reads, ...part.writes].map(draftFieldSegments);
  const writes = part.writes.map(draftFieldSegments);
  const proxies = new WeakMap<object, Map<string, object>>();
  const targets = new WeakMap<object, object>();

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
      proxy = new Proxy(value, handlerAt(position));
      byPath.set(key, proxy);
      targets.set(proxy, value);
    }
    return proxy;
  };

  // The value without any guard inside it, copying only the objects and lists that held one.
  const unwrap = (value: unknown): unknown => {
    if (!isObject(value)) return value;
    const target = targets.get(value);
    if (target !== undefined) return target;
    if (Array.isArray(value)) {
      const items = value.map(unwrap);
      return items.some((item, i) => item !== value[i]) ? items : value;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    let copy: Record<string, unknown> | undefined;
    for (const [member, item] of Object.entries(value)) {
      const plain = unwrap(item);
      if (plain !== item) {
        copy ??= { ...value };
        copy[member] = plain;
      }
    }
    return copy ?? value;
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
    checkWrite(next, value, Reflect.get(target, key));
  };

  const handlerAt = (position: Position): ProxyHandler<object> => ({
    get(target, key, receiver) {
      const next = read(position, target, key);
      const value: unknown = Reflect.get(target, key, receiver);
      return next === undefined ? value : wrap(value, next);
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
      const plain = unwrap(value);
      if (typeof key === "symbol") return Reflect.set(target, key, plain);
      if (Array.isArray(target) && key === "length") {
        const length = typeof plain === "number" ? plain : target.length;
        checkWrite(position, target.slice(0, length), target.slice());
      } else write(position, target, key, plain);
      return Reflect.set(target, key, plain);
    },
    deleteProperty(target, key) {
      if (typeof key !== "symbol") write(position, target, key, undefined);
      return Reflect.deleteProperty(target, key);
    },
    defineProperty(target, key, descriptor) {
      if (typeof key === "symbol" || !("value" in descriptor))
        return Reflect.defineProperty(target, key, descriptor);
      const plain = unwrap(descriptor.value);
      write(position, target, key, plain);
      return Reflect.defineProperty(target, key, { ...descriptor, value: plain });
    },
  });

  return wrap(draft, START) as D;
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
