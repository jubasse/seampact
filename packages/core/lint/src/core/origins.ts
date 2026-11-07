import type { Operation, Origin } from "@seampact/spec/ir";

// Origins as the rules read them: the contract's own elements only, and the node an exception key is written on.

/** Whether the contract wrote the element: a core declaration has no file, a relay copy is linted by its own api. */
export function lintOwnsOrigin(origin: Origin): boolean {
  return origin.layer !== "core" && origin.api === undefined;
}

/** The origin of the node that holds the key `origin` names (`/surfaces/app/routes/tasks/access` -> the route). */
export function lintNodeOf(origin: Origin): Origin {
  return { layer: origin.layer, pointer: origin.pointer.slice(0, origin.pointer.lastIndexOf("/")) };
}

export function lintOriginKey(origin: Origin): string {
  return `${origin.layer}#${origin.pointer}`;
}

export interface LintOriginGroup<Entry> {
  origin: Origin;
  entries: Entry[];
}

/** The entries that share each origin, in first-seen order. */
export function lintGroupByOrigin<Entry extends { origin: Origin }>(
  entries: readonly Entry[],
): LintOriginGroup<Entry>[] {
  const groups = new Map<string, LintOriginGroup<Entry>>();

  for (const entry of entries) {
    const key = lintOriginKey(entry.origin);
    const group = groups.get(key) ?? { origin: entry.origin, entries: [] };

    group.entries.push(entry);
    groups.set(key, group);
  }

  return [...groups.values()];
}

/** `route 'a'` or `routes 'a', 'b'`, for a message. */
export function lintRoutesNamed(operations: readonly Operation[]): string {
  const names = operations.map((operation) => `'${operation.id}'`).join(", ");

  return operations.length === 1 ? `route ${names}` : `routes ${names}`;
}
