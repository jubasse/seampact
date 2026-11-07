// The order every Node server target registers its contract routes in, and the shared matcher iterates: most
// specific first. One total order, so no sort can leave a param route before the static route it would shadow.

const PATH_PARAM_SEGMENT = /\{[^}]+\}/;

/**
 * Compares two path templates segment by segment, a static segment before a param, so `/tasks/search` comes before
 * `/tasks/{id}`; when the shared segments tie, the path with fewer segments first. Paths of the same form compare
 * equal, so a stable sort keeps the contract's order.
 */
export function compareRouteSpecificity(leftPath: string, rightPath: string): number {
  const leftSegments = leftPath.split("/");
  const rightSegments = rightPath.split("/");
  const sharedLength = Math.min(leftSegments.length, rightSegments.length);

  for (let position = 0; position < sharedLength; position++) {
    const leftIsParam = PATH_PARAM_SEGMENT.test(leftSegments[position] ?? "");
    const rightIsParam = PATH_PARAM_SEGMENT.test(rightSegments[position] ?? "");

    if (leftIsParam !== rightIsParam) return leftIsParam ? 1 : -1;
  }

  return leftSegments.length - rightSegments.length;
}
