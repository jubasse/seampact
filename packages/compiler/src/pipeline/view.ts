import type { PassWritable } from "./readonly.js";

// Read-only views for a guarded run (H-6 of the PR 1 review, ADR 0006 section 2): with the guard on, what a half
// reads besides its draft (`raw`, `workspace`, `relayed`, `imported`) is a view that throws on any change, so a
// half that changes the raw tree or another api's draft fails its tests instead of corrupting a later half's
// input. A view never reaches a draft: storing one through the guard throws, and the half stores a plain copy
// (`pipelineCopy`) instead, which it must do with the guard off as well, so the draft never aliases the raw tree or
// another api's draft and a run with the guard on gives the same result as one with it off. Like the guard, a
// view catches our own lanes' mistakes; it is no defence (ADR 0006).

/** What a view guards, for the error message. */
export type PipelineViewSource = "raw" | "workspace" | "relayed" | "imported";

/** A change to a read-only view. */
export class PipelineReadonlyError extends Error {
  override readonly name = "PipelineReadonlyError";
  constructor(
    readonly source: PipelineViewSource,
    /** The concrete path: `merged.surfaces.app`. */
    readonly path: string,
  ) {
    super(
      `${source}${path === "" ? "" : `.${path}`} is read-only: a pass never changes what it reads`,
    );
  }
}

// Each view's target and source, for `pipelineCopy` and `pipelineViewSource`.
const targets = new WeakMap<
  object,
  { readonly target: object; readonly source: PipelineViewSource }
>();

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

/** A read-only view of `value`, all the way down; a primitive is returned as is. */
export function pipelineView<T>(value: T, source: PipelineViewSource): T {
  // One view per target and path, so a view read twice is the same object.
  const views = new WeakMap<object, Map<string, object>>();
  const wrap = (target: unknown, path: string): unknown => {
    if (!isObject(target)) return target;
    let byPath = views.get(target);
    if (byPath === undefined) {
      byPath = new Map();
      views.set(target, byPath);
    }
    let view = byPath.get(path);
    if (view === undefined) {
      const refuse = (key?: string | symbol): never => {
        throw new PipelineReadonlyError(source, key === undefined ? path : join(path, key));
      };
      view = new Proxy(target, {
        get(t, key) {
          const item: unknown = Reflect.get(t, key);
          if (typeof key === "symbol") return item;
          // A frozen member must read as itself (a proxy invariant), so it leaves unwrapped: only a deep-frozen
          // value is safe there, since a mutable object held by a frozen member is not guarded. The raw tree and
          // the drafts hold no frozen member; a frozen object an `imports` IR holds is the caller's to deep-freeze.
          const own = Reflect.getOwnPropertyDescriptor(t, key);
          if (own !== undefined && own.configurable === false && own.writable === false)
            return item;
          return wrap(item, join(path, key));
        },
        set: (_t, key) => refuse(key),
        defineProperty: (_t, key) => refuse(key),
        deleteProperty: (_t, key) => refuse(key),
        setPrototypeOf: () => refuse(),
        preventExtensions: () => refuse(),
      });
      byPath.set(path, view);
      targets.set(view, { target, source });
    }
    return view;
  };
  return wrap(value, "") as T;
}

const join = (path: string, key: string | symbol): string =>
  `${path}${path === "" ? "" : "."}${String(key)}`;

/** The source of a read-only view, or `undefined` when `value` is no view. */
export function pipelineViewSource(value: unknown): PipelineViewSource | undefined {
  return isObject(value) ? targets.get(value)?.source : undefined;
}

/**
 * A plain, writable deep copy of `value`, a read-only view or a plain value: what a half stores in its draft from
 * `raw`, `workspace`, `relayed`, `imported` or an `inherited` entry, with the guard on or off. The copy keeps each
 * object's prototype (none for a catalogue) and defines its members, so a member named `__proto__` stays one.
 * The draft is JSON-shaped data: a value holding any other object (a `Map`, a `Date`, a class instance) throws,
 * naming where it sits, instead of being copied into an object that only looks like it.
 */
export function pipelineCopy<T>(value: T): PassWritable<T> {
  // Only the read-only type is dropped: the copy has the same shape as `value`.
  return copy(value, "") as PassWritable<T>;
}

function copy(value: unknown, path: string): unknown {
  const plain = isObject(value) ? (targets.get(value)?.target ?? value) : value;
  if (!isObject(plain)) return plain;

  if (Array.isArray(plain))
    return plain.map((item, index) => copy(item, join(path, String(index))));

  const prototype: unknown = Object.getPrototypeOf(plain);
  if (prototype !== Object.prototype && prototype !== null) throw notJsonShaped(plain, path);

  const out: object = Object.create(prototype);
  for (const [key, item] of Object.entries(plain))
    Object.defineProperty(out, key, {
      value: copy(item, join(path, key)),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return out;
}

function notJsonShaped(value: object, path: string): TypeError {
  const kind = value.constructor?.name ?? "object with another prototype";
  const where = path === "" ? "the value" : `at ${path}`;
  return new TypeError(
    `pipelineCopy copies JSON-shaped data only (plain objects, arrays and primitives): ${where}: a ${kind}. Store its data as a plain object instead.`,
  );
}
