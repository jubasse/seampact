import type { Name } from "@seampact/spec/ir";
import { deriveName, identifier, isRole } from "@seampact/spec/naming";
import { below, type IrLocation } from "./ir-location.js";
import { refuseUnknownValueAt } from "./located-refusals.js";
import type { Refusal } from "./refusal.js";

// A planned name; the layout holds every id of the IR it was planned from.
export function requireName<Key, Value>(names: ReadonlyMap<Key, Value>, key: Key): Value {
  const name = names.get(key);

  if (name === undefined) throw new Error(`no planned name for ${String(key)}`);

  return name;
}

// The TypeScript type name of a declared name (ADR 0007); an unknown role is refused and gives an empty name.
export function declaredTypeIdentifier(
  name: Name,
  location: IrLocation,
  refusals: Refusal[],
): string {
  const role = name.role;

  if (!isRole(role)) {
    refusals.push(refuseUnknownValueAt(below(location, "role"), role));

    return "";
  }

  return typeScriptIdentifier(deriveName(name.segments, role, name.status));
}

// The TypeScript identifier of a derived type name.
export function typeScriptIdentifier(name: ReturnType<typeof deriveName>): string {
  const typeName = identifier(name, "typescript");

  // Every type role has a TypeScript identifier (ADR 0007 section 4).
  if (typeName === undefined) throw new Error(`the role ${name.role} has no TypeScript identifier`);

  return typeName;
}

// The names one module exports; a second export of one name is refused, naming both members.
export class ExportNames {
  private readonly claimed = new Map<string, string>();

  constructor(private readonly module: string) {}

  claim(exportName: string, location: IrLocation, refusals: Refusal[]): void {
    const first = this.claimed.get(exportName);

    if (first === undefined) {
      this.claimed.set(exportName, location.member);

      return;
    }

    refusals.push({
      code: "export.name.duplicate",
      message: `The name '${exportName}' of ${location.member} is already the name of ${first} in the module '${this.module}'.`,
      fix: "Rename one of the two in the contract so that their names differ.",
      member: location.member,
      ...(location.operation === undefined ? {} : { operation: location.operation }),
    });
  }
}
