import { below, type IrLocation } from "@seampact/codegen-core";
import type { DerivedFrom, Origin, ValueSource } from "@seampact/spec/ir";
import { type EmitContext, refuseInconsistent } from "./emit-context.js";
import type { JsonObject } from "./json-value.js";

// IR values as the extensions write them (ADR 0004 section 12): a value source as the grammar writes it, an origin
// as its side-table key, a derivation by its id.

const PLACES_WITHOUT_NAME: readonly string[] = ["host", "subdomain", "resolver"];
const ADDRESS_PLACE = "address";

/** `path.taskId`, `scope.channel`, `host`, `address/64`. */
export function valueSourceText(
  context: EmitContext,
  source: ValueSource,
  location: IrLocation,
): string {
  if (source.in === ADDRESS_PLACE) {
    return source.prefixBits === undefined
      ? ADDRESS_PLACE
      : `${ADDRESS_PLACE}/${source.prefixBits}`;
  }

  if (PLACES_WITHOUT_NAME.includes(source.in)) return source.in;

  if (source.name === undefined) {
    refuseInconsistent(
      context,
      "value-source.name",
      `A value source in '${source.in}' without its name`,
      below(location, "name"),
    );

    return source.in;
  }

  return `${source.in}.${source.name}`;
}

/**
 * `api#/surfaces/app/routes/...`, `core#/errors/api.internal`; an origin copied from another api leads with it and
 * `#` (`billing#api#/routes/...`), which no layer holds, so `pack:<name>` layers stay unambiguous.
 */
export function originKey(origin: Origin): string {
  const key = `${origin.layer}#${origin.pointer}`;

  return origin.api === undefined ? key : `${origin.api}#${key}`;
}

/** `{ derivation, from }`, the value of `x-seampact-derived-from`. */
export function derivedFromValue(derivedFrom: DerivedFrom): JsonObject {
  return { derivation: derivedFrom.derivation, from: derivedFrom.from.map(originKey) };
}
