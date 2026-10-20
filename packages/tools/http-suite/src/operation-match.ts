// The operation of a contract that answers a request: same method (HEAD runs GET) and a path that fits the
// operation's path template segment by segment.
import type { Operation } from "@seampact/spec/ir";

const HEAD_METHOD = "head";
const GET_METHOD = "get";
const PATH_PARAMETER = /^\{[^{}]+\}$/;

/** A request as the suite sent it: its method and its path, query included. */
export interface SentRequest {
  readonly method: string;
  readonly path: string;
}

export function operationAnswering(
  operations: readonly Operation[],
  request: SentRequest,
): Operation | undefined {
  const method = request.method.toLowerCase();
  const answeredMethod = method === HEAD_METHOD ? GET_METHOD : method;
  const segments = pathWithoutQuery(request.path).split("/");

  return operations.find(
    (operation) =>
      operation.method.toLowerCase() === answeredMethod &&
      pathFits(operation.path.split("/"), segments),
  );
}

function pathWithoutQuery(path: string): string {
  const queryStart = path.indexOf("?");

  return queryStart === -1 ? path : path.slice(0, queryStart);
}

function pathFits(templateSegments: readonly string[], segments: readonly string[]): boolean {
  if (templateSegments.length !== segments.length) return false;

  return templateSegments.every((templateSegment, index) => {
    const segment = segments[index] ?? "";

    return PATH_PARAMETER.test(templateSegment) ? segment !== "" : templateSegment === segment;
  });
}
