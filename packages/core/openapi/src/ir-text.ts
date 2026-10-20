import type { DerivedFrom, Origin, ValueSource } from "@seampact/spec/ir";
import type { JsonObject } from "./json-value.js";

// IR values as the extensions write them (ADR 0004 section 12): a value source as the grammar writes it, an origin
// as its side-table key, a derivation by its id.

const PLACES_WITHOUT_NAME: readonly string[] = ["host", "subdomain", "resolver"];
const ADDRESS_PLACE = "address";

/** `path.taskId`, `scope.channel`, `host`, `address/64`. */
export function valueSourceText(source: ValueSource): string {
  if (source.in === ADDRESS_PLACE) {
    return source.prefixBits === undefined ? ADDRESS_PLACE : `${ADDRESS_PLACE}/${source.prefixBits}`;
  }

  if (PLACES_WITHOUT_NAME.includes(source.in) || source.name === undefined) return source.in;

  return `${source.in}.${source.name}`;
}

/** `api#/surfaces/app/routes/...`, `core#/errors/api.internal`; an origin copied from another api leads with it. */
export function originKey(origin: Origin): string {
  const key = `${origin.layer}#${origin.pointer}`;

  return origin.api === undefined ? key : `${origin.api}:${key}`;
}

/** `{ derivation, from }`, the value of `x-seampact-derived-from`. */
export function derivedFromValue(derivedFrom: DerivedFrom): JsonObject {
  return { derivation: derivedFrom.derivation, from: derivedFrom.from.map(originKey) };
}
