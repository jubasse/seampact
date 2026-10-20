// The source values the route table module writes: plain data, source expressions such as an imported validator,
// and the IR templates as the runtime's `FormatTemplate`.
import { isKnownVariant, type Template } from "@seampact/spec/ir";
import { below, type IrLocation } from "../ir-location.js";
import { refuseNotGeneratedYet } from "../located-refusals.js";
import type { Refusal } from "../refusal.js";

export class SourceExpression {
  constructor(readonly text: string) {}
}

export type SourceValue =
  | SourceExpression
  | string
  | number
  | boolean
  | undefined
  | null
  | readonly SourceValue[]
  | { readonly [member: string]: SourceValue };

export function isSlot(value: Template, slot: string): boolean {
  return isKnownVariant("Template", value) && value.kind === "slot" && value.slot === slot;
}

export function template(node: Template, location: IrLocation, refusals: Refusal[]): SourceValue {
  if (isKnownVariant("Template", node)) {
    if (node.kind === "slot") return { kind: "slot", slot: node.slot, path: node.path };

    if (node.kind === "literal") return { kind: "literal", value: jsonValue(node.value) ?? null };

    if (node.kind === "each") {
      return {
        kind: "each",
        of: node.of,
        as: template(node.as, below(location, "as"), refusals),
      };
    }

    if (node.kind === "object") {
      return {
        kind: "object",
        members: node.members.flatMap((member, index) => {
          if (!isKnownVariant("MemberName", member.name) || member.name.kind !== "text") {
            refusals.push(
              refuseNotGeneratedYet(
                "format.memberName",
                "A computed member name",
                below(location, "members", String(index)),
              ),
            );

            return [];
          }

          return [
            {
              name: member.name.text,
              value: template(member.value, below(location, "members", String(index)), refusals),
            },
          ];
        }),
      };
    }
  }

  refusals.push(refuseNotGeneratedYet("format.template", `A '${node.kind}' template`, location));

  return { kind: "text", text: "" };
}

// IR values such as a requirement's params are JSON, written as is.
export function jsonValue(value: unknown): SourceValue {
  if (value === undefined) return undefined;

  return new SourceExpression(JSON.stringify(value));
}

export function sourceOf(value: SourceValue): string {
  if (value instanceof SourceExpression) return value.text;

  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";

  if (Array.isArray(value)) return `[${value.map(sourceOf).join(", ")}]`;

  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .map(([name, member]) => `${JSON.stringify(name)}: ${sourceOf(member)}`);

  return `{ ${members.join(", ")} }`;
}
