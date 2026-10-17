import type { IrWriter } from "@seampact/spec/ir";

// Value sources (ADR 0002 section 4) in their IR form (ADR 0004 section 13: `{ in, name?, prefixBits? }`). The
// authoring schema has checked each against its use: a requirement subject, a scope id or a bucket key.

const NAMED_SOURCES = ["path", "query", "header", "body", "principal", "scope"] as const;
const BARE_SOURCES = ["host", "subdomain", "address", "resolver"] as const;

type NamedSource = (typeof NAMED_SOURCES)[number];
type BareSource = (typeof BARE_SOURCES)[number];

const isNamedSource = (text: string): text is NamedSource =>
  NAMED_SOURCES.some((source) => source === text);

const isBareSource = (text: string): text is BareSource =>
  BARE_SOURCES.some((source) => source === text);

const ADDRESS_PREFIX = /^address\/([0-9]+)$/;

/**
 * The IR form of a value source text, undefined for a text outside the grammar's forms. An address prefix
 * (`address/64`) keeps its bits as written; the caller checks their range.
 */
export function accessRightsValueSource(text: string): IrWriter.ValueSource | undefined {
  if (isBareSource(text)) return { in: text };

  const prefix = ADDRESS_PREFIX.exec(text);

  if (prefix !== null) return { in: "address", prefixBits: Number(prefix[1]) };

  const dot = text.indexOf(".");
  const kind = dot < 0 ? text : text.slice(0, dot);

  if (dot < 0 || !isNamedSource(kind)) return undefined;

  return { in: kind, name: text.slice(dot + 1) };
}

/** The text of an IR value source, as a contract writes it. */
export function accessRightsSourceText(source: IrWriter.ValueSource): string {
  if (source.prefixBits !== undefined) return `${source.in}/${source.prefixBits}`;

  return source.name === undefined ? source.in : `${source.in}.${source.name}`;
}
