// Read-only views for a guarded run (H-6 of the PR 1 review, ADR 0006 section 2): with the guard on, what a half
// reads besides its draft (`raw`, `workspace`, `relayed`, `imported`) is a view that throws on any change, so a
// half that changes the raw tree or another api's draft fails its tests instead of corrupting a later half's
// input. A view never reaches a draft: the guard stores a plain copy of it (`pipelineViewCopy`), so the draft does
// not alias the raw tree. Like the guard, a view catches our own lanes' mistakes; it is no defence (ADR 0006).

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

// Each view's target, for `pipelineViewCopy`.
const targets = new WeakMap<object, object>();

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
          // A frozen member must read as itself (a proxy invariant); it cannot change anyway.
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
      targets.set(view, target);
    }
    return view;
  };
  return wrap(value, "") as T;
}

const join = (path: string, key: string | symbol): string =>
  `${path}${path === "" ? "" : "."}${String(key)}`;

/**
 * A plain, writable deep copy of a view's target, or `undefined` when `value` is no view. The copy keeps each
 * object's prototype (none for a catalogue) and defines its members, so a member named `__proto__` stays one.
 */
export function pipelineViewCopy(value: unknown): unknown {
  const target = isObject(value) ? targets.get(value) : undefined;
  return target === undefined ? undefined : copy(target);
}

function copy(value: unknown): unknown {
  const plain = isObject(value) ? (targets.get(value) ?? value) : value;
  if (!isObject(plain)) return plain;
  if (Array.isArray(plain)) return plain.map(copy);
  const out: object = Object.create(Object.getPrototypeOf(plain));
  for (const [key, item] of Object.entries(plain))
    Object.defineProperty(out, key, {
      value: copy(item),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return out;
}
