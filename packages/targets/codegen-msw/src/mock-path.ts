import {
  below,
  operationLocation,
  type Refusal,
  refuseNotGeneratedYet,
} from "@seampact/codegen-core";
import { compareRouteSpecificity } from "@seampact/codegen-core/node-server";
import type { ContractIR, Operation } from "@seampact/spec/ir";

// MSW reads a handler path with path-to-regexp: literal text is written as the URL carries it, then escaped.

const PATH_PARAM = /\{([^}]+)\}/g;
const WHOLE_PATH_PARAM = /^\{[^}]+\}$/;
const ROUTE_SYNTAX = /[:()+?{}\\]/g;
const URL_BASE = "http://mock.invalid";

// MSW turns `*` into a wildcard before path-to-regexp reads the path, and `:` before digits at a segment's end into
// a port escape, so neither can be written as literal text.
const UNESCAPABLE_LITERAL = /\*|:\d+$/;

/** The MSW path of a contract path: `{channelId}` becomes `:channelId`, and literal text matches only itself. */
export function mockPathOf(contractPath: string): string {
  return contractPath
    .split(PATH_PARAM)
    .map((part, index) => (index % 2 === 1 ? `:${part}` : escapedLiteral(part)))
    .join("");
}

// The text as the client's URL carries it (`é` as `%C3%A9`), with the route syntax escaped.
function escapedLiteral(text: string): string {
  if (text === "") return text;

  const encoded = new URL(`${URL_BASE}/${text}`).pathname.slice(1);

  return encoded.replace(ROUTE_SYNTAX, (character) => `\\${character}`);
}

/** A static segment MSW cannot match as written, such as `tasks:2024` or `all*`, refused by name. */
export function unescapableSegmentRefusals(ir: ContractIR): Refusal[] {
  return ir.operations.flatMap((operation, index) =>
    operation.path
      .split("/")
      .some((segment) => !WHOLE_PATH_PARAM.test(segment) && UNESCAPABLE_LITERAL.test(segment))
      ? [
          refuseNotGeneratedYet(
            "path.segment.literal",
            "A static path segment that holds '*' or ends in ':' and digits, such as 'tasks:2024',",
            below(operationLocation(index, operation.id), "path"),
          ),
        ]
      : [],
  );
}

/**
 * The MSW paths of the operations with the same method whose route comes before this one and matches a URL it
 * matches too (`/tasks/search` for `/tasks/{taskId}`): the handler lets such a request through to their handler.
 */
export function shadowingSiblingPaths(operation: Operation, ir: ContractIR): string[] {
  return ir.operations
    .filter(
      (sibling) =>
        sibling.id !== operation.id &&
        sibling.method === operation.method &&
        compareRouteSpecificity(sibling.path, operation.path) < 0 &&
        routesOverlap(sibling.path, operation.path),
    )
    .map((sibling) => mockPathOf(sibling.path));
}

function routesOverlap(leftPath: string, rightPath: string): boolean {
  const leftSegments = leftPath.split("/");
  const rightSegments = rightPath.split("/");

  return (
    leftSegments.length === rightSegments.length &&
    leftSegments.every((left, position) => {
      const right = rightSegments[position] ?? "";

      return left === right || WHOLE_PATH_PARAM.test(left) || WHOLE_PATH_PARAM.test(right);
    })
  );
}
