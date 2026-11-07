import { below, refuseUnknownValueAt } from "@seampact/codegen-core";
import type { Operation, PagingRequestRole } from "@seampact/spec/ir";
import { pagingStyleOf } from "./operation-output.js";
import type { TypeContext } from "./type-expression.js";

// The literal types of a list's sort parameters, read from its `paging.sortKeys` and its sort style (grammar
// section 14), so a request names a declared key only: `signed` takes a key or its `-` form, `pair` a key and a
// direction, `keyed` a direction per key, `split` a key and a direction parameter. The IR types the same values
// as patterns; TypeScript gets the union.

const DESCENDING_PREFIX = "-";
const PAIR_SEPARATOR = ",";
const KEY_PLACEHOLDER = "{key}";
const SORT_DIRECTIONS: readonly string[] = ["asc", "desc"];

/** The parameters of the operation's sort role sent in `place`, by wire name, with their literal type. */
export function sortParamTypes(
  operation: Operation,
  place: PagingRequestRole["in"],
  context: TypeContext,
): ReadonlyMap<string, string> {
  const keys = (operation.paging?.sortKeys ?? []).map((sortKey) => sortKey.key);
  const style = pagingStyleOf(operation, context.ir);
  const roleIndex = style?.request.findIndex((role) => role.role === "sort") ?? -1;
  const role = style?.request[roleIndex];

  if (style === undefined || role === undefined || role.in !== place || keys.length === 0)
    return new Map();

  const sortStyle = role.style ?? "signed";
  const directions = union(SORT_DIRECTIONS);

  switch (sortStyle) {
    case "signed":
      return new Map([
        [role.name, listOf(keys.flatMap((key) => [key, `${DESCENDING_PREFIX}${key}`]))],
      ]);
    case "pair":
      return new Map([
        [
          role.name,
          listOf(
            keys.flatMap((key) =>
              SORT_DIRECTIONS.map((direction) => `${key}${PAIR_SEPARATOR}${direction}`),
            ),
          ),
        ],
      ]);
    case "keyed":
      return new Map(keys.map((key) => [role.name.replace(KEY_PLACEHOLDER, key), directions]));
    case "split":
      return new Map([
        [role.name, union(keys)],
        ...(role.direction === undefined ? [] : [[role.direction, directions] as const]),
      ]);
    default:
      context.refusals.push(
        refuseUnknownValueAt(
          below({ member: "" }, "pagings", style.id, "request", roleIndex, "style"),
          sortStyle,
        ),
      );

      return new Map();
  }
}

const union = (values: readonly string[]): string =>
  values.map((value) => JSON.stringify(value)).join(" | ");

const listOf = (values: readonly string[]): string => `(${union(values)})[]`;
