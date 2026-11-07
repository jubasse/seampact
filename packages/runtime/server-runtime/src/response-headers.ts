// The response headers the route table derives (ADR 0004 section 7): a deprecated operation's Deprecation and
// Sunset texts and its successor Link, and the strong entity tag of an item versioned by `If-Match` (grammar
// section 6). Shared by every server profile.
import type { CheckState } from "./access-checks.js";
import { type ContractError, unexpectedError } from "./contract-error.js";
import type { ResponseEntry } from "./contract-route.js";
import { isPlainObject } from "./plain-object.js";
import { decodePathParam } from "./wire-decoding.js";

/** A response's derived headers: those of a success, and the entity tag, which a 304 keeps too. */
export interface DerivedResponseHeaders {
  readonly successHeaders: readonly [name: string, value: string][];
  readonly entityTag?: readonly [name: string, value: string];
}

const PATH_PARAM = /\{([^}]+)\}/g;
// RFC 3986 `unreserved`: every other octet of a path param's UTF-8 bytes is percent-encoded, `%` included.
const UNRESERVED_CHARACTER = /^[A-Za-z0-9\-._~]$/;
// RFC 9110 section 8.8.3 `etagc`: a version whose text holds another character makes no strong entity tag.
const ENTITY_TAG_TEXT = /^[\x21\x23-\x7e]*$/;
const HEX_RADIX = 16;
const ENCODED_OCTET_DIGITS = 2;

/** The derived headers of `response` for the handler's body; a body the entity tag cannot be read from is a 500. */
export function derivedResponseHeaders(
  state: CheckState,
  response: ResponseEntry,
  handlerBody: unknown,
): DerivedResponseHeaders {
  const successHeaders: [string, string][] = [];
  let entityTag: [string, string] | undefined;

  for (const header of response.headers) {
    switch (header.kind) {
      case "text":
        successHeaders.push([header.name, header.value]);
        break;
      case "successorLink":
        successHeaders.push([
          header.name,
          successorLink(header.path, header.rel, state.pathParams),
        ]);
        break;
      case "entityTag":
        entityTag = [header.name, versionEntityTag(state, header.field, handlerBody)];
        break;
    }
  }

  return entityTag === undefined ? { successHeaders } : { successHeaders, entityTag };
}

/**
 * RFC 8288: `<target>; rel="<rel>"`, the target the successor's path with each param the request's param of the
 * same name, its decoded value encoded as one path segment, so a value never breaks out of the link.
 */
export function successorLink(
  path: string,
  rel: string,
  encodedPathParams: Readonly<Record<string, string>>,
): string {
  const target = path.replace(PATH_PARAM, (_, name: string) => {
    const encoded = encodedPathParams[name];

    if (encoded === undefined)
      throw new Error(
        `the successor path '${path}' names the param '${name}', which the request has not`,
      );

    return encodedPathSegment(decodePathParam(encoded));
  });

  return `<${target}>; rel="${rel}"`;
}

/** Every octet of the value's UTF-8 bytes outside RFC 3986 `unreserved` percent-encoded. */
export function encodedPathSegment(value: string): string {
  return Array.from(new TextEncoder().encode(value), (octet) => {
    const character = String.fromCharCode(octet);

    if (UNRESERVED_CHARACTER.test(character)) return character;

    return `%${octet.toString(HEX_RADIX).toUpperCase().padStart(ENCODED_OCTET_DIGITS, "0")}`;
  }).join("");
}

// The item's version as a strong entity tag, `"7"`: the field's integer or text, as the client sends it back.
function versionEntityTag(state: CheckState, field: string, item: unknown): string {
  const version = isPlainObject(item) && Object.hasOwn(item, field) ? item[field] : undefined;
  const text =
    typeof version === "number" && Number.isSafeInteger(version)
      ? String(version)
      : typeof version === "string"
        ? version
        : undefined;

  if (text === undefined || !ENTITY_TAG_TEXT.test(text)) throw unreadableVersion(state, field);

  return `"${text}"`;
}

function unreadableVersion(state: CheckState, field: string): ContractError {
  return unexpectedError(
    state.route,
    new Error(
      `the handler of '${state.route.id}' returned an item whose version field '${field}' is no integer or entity tag text, so its ETag cannot be written`,
    ),
  );
}
