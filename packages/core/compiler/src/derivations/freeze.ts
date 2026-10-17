import type { PassReadonly } from "../pipeline/readonly.js";

// The derivation and role data are shared by every compile in a process, so they are frozen all the way down: a
// half that wrote a role's type use into its draft as is, then changed it there, would change it for every later
// compile. A half writes a copy (`derivationCopy`) instead.

/** Freezes `value` and everything reachable from it. */
export function derivationFreeze<T>(value: T): PassReadonly<T> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) derivationFreeze(item);
    Object.freeze(value);
  }
  return value as PassReadonly<T>;
}

/**
 * A fresh, writable deep copy of frozen derivation data, to write into a draft:
 * `derivationCopy<IrWriter.TypeUse>(datum.type)`.
 */
export function derivationCopy<T>(value: PassReadonly<T>): T {
  // `structuredClone` returns unfrozen copies of plain data; only the readonly view is cast away.
  return structuredClone(value) as T;
}
