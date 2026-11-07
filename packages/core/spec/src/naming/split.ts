// ADR 0007 section 2: splitting a written name into segments.

const Kind = { Other: 0, Lower: 1, Upper: 2, Digit: 3 } as const;

type Kind = (typeof Kind)[keyof typeof Kind];

function kindOf(code: number): Kind {
  if (code >= 97 && code <= 122) return Kind.Lower;

  if (code >= 65 && code <= 90) return Kind.Upper;

  if (code >= 48 && code <= 57) return Kind.Digit;

  return Kind.Other;
}

/**
 * Splits a written name with the four rules of ADR 0007 section 2. Pure and total: any string
 * gives a (possibly empty) list of non-empty `[a-z0-9]+` segments. Only ASCII is looked at, so
 * the result never depends on a locale.
 */
export function splitName(written: string): string[] {
  const segments: string[] = [];
  let start = -1; // index where the current segment starts, -1 outside a run
  const length = written.length;

  for (let i = 0; i < length; i++) {
    const kind = kindOf(written.charCodeAt(i));

    if (kind === Kind.Other) {
      if (start >= 0) segments.push(written.slice(start, i).toLowerCase());
      start = -1;
      continue;
    }

    if (start < 0) {
      start = i;
      continue;
    }

    if (kind !== Kind.Upper) continue;
    const previous = kindOf(written.charCodeAt(i - 1));
    const next = i + 1 < length ? kindOf(written.charCodeAt(i + 1)) : Kind.Other;

    // Rule 2: an uppercase letter after a lowercase letter or a digit starts a segment; so does
    // one that ends an uppercase run and is followed by a lowercase letter (`HTTPServer`).
    if (
      previous === Kind.Lower ||
      previous === Kind.Digit ||
      (previous === Kind.Upper && next === Kind.Lower)
    ) {
      segments.push(written.slice(start, i).toLowerCase());
      start = i;
    }
  }

  if (start >= 0) segments.push(written.slice(start).toLowerCase());

  return segments;
}

/** Where a written name comes from; it decides what a name without any segment means. */
export type NameSource = "name" | "enumValue" | "right";

export type SegmentsResult = { ok: true; segments: string[] } | { ok: false; reason: "no-segment" };

/**
 * The segments of a written name in its context (ADR 0007 section 2, last paragraph).
 *
 * - `codeName` replaces the segments split from the written name, for every source; one that
 *   yields no segment is `{ ok: false }`, never the enum fallback.
 * - An enum value without a segment becomes `value<position>`, `position` being one-based. It is
 *   required for an enum value (a positive integer) and throws when missing, so that a fallback
 *   name never depends on a guess.
 * - A right without a segment is `{ ok: false }` unless `codeName` is set: the caller turns the
 *   failure into the diagnostic naming the right, with the fix "set its `codeName`".
 * - Any other name without a segment is `{ ok: false }` too; the grammar's name patterns make it
 *   unreachable, and the caller reports it.
 */
export function segmentsOf(
  written: string,
  source: NameSource,
  options: { codeName?: string; position?: number } = {},
): SegmentsResult {
  const { codeName, position } = options;

  if (source === "enumValue" && (!Number.isInteger(position) || (position as number) < 1)) {
    throw new Error(`an enum value needs its one-based position, got ${String(position)}`);
  }

  const split = splitName(codeName ?? written);

  if (split.length > 0) return { ok: true, segments: split };

  if (source === "enumValue" && codeName === undefined) {
    return { ok: true, segments: [`value${position}`] };
  }

  return { ok: false, reason: "no-segment" };
}
