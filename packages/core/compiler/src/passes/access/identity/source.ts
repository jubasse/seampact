import type { IrWriter } from "@seampact/spec/ir";

// Value sources (ADR 0002 section 4) in their IR form (ADR 0004 section 13: `{ in, name }`). This half reads the
// named forms only: a signature key (path, query, header), a header use's `from` (principal) and, per operation,
// a binding (path, query, body, principal). The authoring schema has checked each against its use.

const NAMED_SOURCES = ["path", "query", "header", "body", "principal", "scope"] as const;

type NamedSource = (typeof NAMED_SOURCES)[number];

const isNamedSource = (text: string): text is NamedSource =>
  NAMED_SOURCES.some((source) => source === text);

/** The IR form of a named value source (`path.workspaceId`, `principal.profile.id`). */
export function accessIdentityValueSource(text: string): IrWriter.ValueSource {
  const dot = text.indexOf(".");
  const kind = dot < 0 ? text : text.slice(0, dot);

  if (dot < 0 || !isNamedSource(kind))
    throw new Error(
      `access.identity reads named value sources only (${NAMED_SOURCES.join(", ")}): '${text}'`,
    );

  return { in: kind, name: text.slice(dot + 1) };
}
