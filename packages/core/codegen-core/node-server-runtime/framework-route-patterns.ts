// The allow-list of the framework-route boot check (ADR 0012 "The boot check", ADR 0011 "The app config"): which
// routes a framework lists the app config allow-lists, by path or pattern (`*` one segment, `**` any number, a `*`
// inside a segment any characters but `/`), each listed route once. Copied into the generated tree as is.

/**
 * One `frameworkRoutes` entry of the app config: a path or a pattern (`*` one segment, `**` any number, a `*` inside
 * a segment any characters but `/`).
 */
export interface FrameworkRouteAllowance {
  readonly method?: string;
  readonly path: string;
  readonly reason: string;
}

/** The check as the app config asks it: on with its allow-list, or off (`artefacts.bootCheck.frameworkRoutes`). */
export type FrameworkRouteCheck =
  | { readonly status: "on"; readonly allowed: readonly FrameworkRouteAllowance[] }
  | { readonly status: "off" };

/** A route as a framework lists it: its upper-case method, `ALL` for every method, and its path pattern. */
export interface ListedRoute {
  readonly method: string;
  readonly path: string;
}

const ANY_METHOD = "ALL";
const HEAD_METHOD = "HEAD";
const GET_METHOD = "GET";
const ONE_SEGMENT = "*";
const ANY_SEGMENTS = "**";
const STAR = "*";
// No allowance segment can be empty, so this token never equals one.
const CATCH_ALL_SEGMENT = "";

/**
 * The listed routes the allow-list does not name, each once; none when the check is off. A `HEAD` route the
 * framework adds beside a `GET` route follows that route.
 */
export function unlistedFrameworkRoutes(
  check: FrameworkRouteCheck,
  listed: readonly ListedRoute[],
): ListedRoute[] {
  if (check.status === "off") return [];

  const reported = new Set<string>();
  const unlisted: ListedRoute[] = [];

  for (const route of listed) {
    const key = routeKey(route.method, route.path);

    if (reported.has(key)) continue;

    if (check.allowed.some((allowance) => isAllowedBy(route, allowance))) continue;

    if (route.method === HEAD_METHOD && reported.has(routeKey(GET_METHOD, route.path))) continue;

    reported.add(key);
    unlisted.push({ method: route.method, path: route.path });
  }

  return unlisted;
}

/** The boot check's one problem for every unlisted route; none when every listed route is allowed. */
export function unlistedFrameworkRoutesProblem(
  check: FrameworkRouteCheck,
  listed: readonly ListedRoute[],
): { readonly problem: string; readonly fix: string } | undefined {
  const keys = unlistedFrameworkRoutes(check, listed).map((route) =>
    routeKey(route.method, route.path),
  );

  if (keys.length === 0) return undefined;

  const named = keys.map((key) => `'${key}'`).join(", ");

  return {
    problem:
      keys.length === 1
        ? `the framework route ${named} is outside the contract and not allow-listed`
        : `${keys.length} framework routes are outside the contract and not allow-listed: ${named}`,
    fix: "allow-list each with a reason in the target entry's 'frameworkRoutes' of seampact.config.yaml, or remove the route; after editing frameworkRoutes, run seampact generate again",
  };
}

/** A route as the boot check names it: `'<METHOD> <path>'`. */
export function routeKey(method: string, path: string): string {
  return `${method} ${path}`;
}

function isAllowedBy(route: ListedRoute, allowance: FrameworkRouteAllowance): boolean {
  if (allowance.method !== undefined && !methodFollows(route.method, allowance.method)) {
    return false;
  }

  return segmentsMatch(segmentsOf(allowance.path), routeSegmentsOf(route.path));
}

// A listed method follows a named one when it is that method, or `HEAD` beside a `GET`.
function methodFollows(listed: string, named: string): boolean {
  const upperNamed = named.toUpperCase();

  return (
    listed === upperNamed ||
    upperNamed === ANY_METHOD ||
    (listed === HEAD_METHOD && upperNamed === GET_METHOD)
  );
}

// One step per pattern segment, as a glob matcher does: `ends[index]` says the pattern so far can end before path
// segment `index`. Pattern times path steps, never a backtrack, however many `**` the pattern has.
function segmentsMatch(pattern: readonly string[], path: readonly string[]): boolean {
  let ends = path.map(() => false).concat(false);

  ends[0] = true;

  for (const patternSegment of pattern) {
    ends =
      patternSegment === ANY_SEGMENTS
        ? endsAfterAnySegments(ends)
        : endsAfterOneSegment(ends, patternSegment, path);
  }

  return ends[path.length] === true;
}

// `**` takes any number of segments, catch-all segments included.
function endsAfterAnySegments(ends: readonly boolean[]): boolean[] {
  let reached = false;

  return ends.map((end) => {
    reached ||= end;

    return reached;
  });
}

// A catch-all segment of a route serves any number of segments, so only `**` matches it, never `*` or a literal.
function endsAfterOneSegment(
  ends: readonly boolean[],
  patternSegment: string,
  path: readonly string[],
): boolean[] {
  return ends.map((_, index) => {
    const segment = path[index - 1];

    if (index === 0 || ends[index - 1] !== true) return false;

    if (segment === undefined || segment === CATCH_ALL_SEGMENT) return false;

    return segmentMatches(patternSegment, segment);
  });
}

// A `*` inside a pattern segment takes any characters, none included; the rest of the segment is literal.
function segmentMatches(patternSegment: string, segment: string): boolean {
  if (patternSegment === ONE_SEGMENT) return true;

  const [prefix = "", ...afterStars] = patternSegment.split(STAR);

  if (afterStars.length === 0) return patternSegment === segment;

  const suffix = afterStars[afterStars.length - 1] ?? "";
  const middles = afterStars.slice(0, -1);

  if (segment.length < prefix.length + suffix.length) return false;

  if (!segment.startsWith(prefix) || !segment.endsWith(suffix)) return false;

  return middlesFollow(middles, segment.slice(prefix.length, segment.length - suffix.length));
}

// The literal parts between stars appear in order; taking each at its first place leaves the most room for the next.
function middlesFollow(middles: readonly string[], text: string): boolean {
  let searchFrom = 0;

  for (const middle of middles) {
    const found = text.indexOf(middle, searchFrom);

    if (found === -1) return false;

    searchFrom = found + middle.length;
  }

  return true;
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

// Each framework writes a catch-all its own way (`*`, `*rest`, `:path*`, a regular expression): a segment with a
// star is a catch-all, kept apart from a one-segment param (`:id`, `{id}`).
function routeSegmentsOf(path: string): string[] {
  return segmentsOf(path).map((segment) => (segment.includes(STAR) ? CATCH_ALL_SEGMENT : segment));
}
