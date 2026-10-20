// The wire decoding of path, query and header strings before the validator (ADR 0002 section 7). Copied into the
// generated tree as is.

/** How a path, query or header string is decoded by the IR's wire form before the validator (ADR 0002 section 7). */
export type WireDecoding = "text" | "number" | "boolean" | "list";

export interface ParamRule {
  /** The name as the validator's input object keys it: as declared for path and query, lower case for headers. */
  readonly name: string;
  readonly decoding: WireDecoding;
  /** On a path param with a `maxLength`: the longest percent-encoded form of a valid value. */
  readonly encodedMaxLength?: number;
}

/**
 * The query members the validator receives, from the raw query string decoded as a form (ADR 0002 section 7).
 * A comma list is split before percent-decoding, so an encoded comma (`%2C`) stays inside its item.
 */
export function decodeQueryMembers(
  rules: readonly ParamRule[],
  rawQuery: string,
): Record<string, unknown> {
  const queryValues = new Map<string, unknown[]>();

  for (const [rawName, rawValue] of rawQueryPairs(rawQuery)) {
    const name = formDecoded(rawName);
    const rule = rules.find((candidate) => candidate.name === name);
    const value = decodeQueryValue(rawValue, rule);

    queryValues.set(name, [...(queryValues.get(name) ?? []), value]);
  }

  // A repeated member reaches the validator as the list of its values, so it reports it rather than one value
  // winning: a proxy reading the first and the boundary the last would disagree.
  return Object.fromEntries(
    [...queryValues].map(([name, values]) => [name, values.length === 1 ? values[0] : values]),
  );
}

// An undeclared member reaches the strict validator raw, so it reports it.
function decodeQueryValue(rawValue: string, rule: ParamRule | undefined): unknown {
  if (rule === undefined) return formDecoded(rawValue);

  if (rule.decoding === "list") return rawValue === "" ? [] : rawValue.split(",").map(formDecoded);

  return decodeWireString(formDecoded(rawValue), rule.decoding);
}

// The name and value of each `&`-separated pair, still encoded; an empty pair is skipped, as a form parser does.
function rawQueryPairs(rawQuery: string): [string, string][] {
  return rawQuery
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair): [string, string] => {
      const name = rawPairName(pair);

      return [name, pair.slice(name.length + 1)];
    });
}

function rawPairName(pair: string): string {
  const separator = pair.indexOf("=");

  return separator === -1 ? pair : pair.slice(0, separator);
}

// One form-encoded component decoded by the platform's form parser: `+` is a space, a malformed escape stays.
function formDecoded(rawComponent: string): string {
  if (!rawComponent.includes("%") && !rawComponent.includes("+")) return rawComponent;

  return new URLSearchParams(`=${rawComponent}`).get("") ?? "";
}

const NUMBER_TEXT = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

// A value that does not decode stays the raw string, so the validator reports it with every other issue.
export function decodeWireString(raw: string, decoding: WireDecoding): unknown {
  switch (decoding) {
    case "text":
      return raw;
    case "number":
      return NUMBER_TEXT.test(raw) ? Number(raw) : raw;
    case "boolean":
      return raw === "true" ? true : raw === "false" ? false : raw;
    case "list":
      return raw === "" ? [] : raw.split(",");
  }
}

/** A path param percent-decoded; a malformed escape stays raw, so the validator reports the value (step 6). */
export function decodePathParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// Bytes outside the RFC 3986 query set (and `%`, `,` kept as sent) are percent-encoded, so a raw `>` or `"` the
// server accepted cannot break the `Link` target built from the pair.
const NOT_QUERY_SAFE = /[^A-Za-z0-9\-._~!$&'()*+,;=:@/?%]|%(?![0-9A-Fa-f]{2})/gu;

function queryEncodedPair(pair: string): string {
  return pair.replace(NOT_QUERY_SAFE, (character) => encodeURIComponent(character));
}

/** The raw query string with the member `name` set to `value`, every other pair kept as received, made link-safe. */
export function withQueryMember(rawQuery: string, name: string, value: string): string {
  const keptPairs = rawQuery
    .split("&")
    .filter((pair) => pair !== "" && formDecoded(rawPairName(pair)) !== name)
    .map(queryEncodedPair);

  return [...keptPairs, `${encodeURIComponent(name)}=${encodeURIComponent(value)}`].join("&");
}
