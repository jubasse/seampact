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

/**
 * Which listed routes the check reads: every one (`strict`), or those that can serve a path at or under one of the
 * api's (mounted) base paths, the default.
 */
export type FrameworkRouteScope = "strict" | { readonly basePaths: readonly string[] };

/** The check as the app config asks it: on with its allow-list, or off (`artefacts.bootCheck.frameworkRoutes`). */
export type FrameworkRouteCheck =
  | {
      readonly status: "on";
      readonly allowed: readonly FrameworkRouteAllowance[];
      readonly scope: FrameworkRouteScope;
    }
  | { readonly status: "off" };

/** The `pathSyntax` of a route the app wrote as a regular expression, whose `path` is that expression's text. */
export const REGULAR_EXPRESSION_PATH = "regular-expression";

/** A route as a framework lists it: its upper-case method, `ALL` for every method, and its path pattern. */
export interface ListedRoute {
  readonly method: string;
  readonly path: string;
  readonly pathSyntax?: typeof REGULAR_EXPRESSION_PATH;
}

// How the scope reads a route segment: a literal (compared without case, as Express and Fastify's `caseSensitive:
// false` match it), a param that takes one segment, or a catch-all that may take any number.
type ScopeSegment =
  | { readonly kind: "literal"; readonly lowerCaseText: string }
  | { readonly kind: "param" }
  | { readonly kind: "catch-all" };

const ANY_METHOD = "ALL";
const HEAD_METHOD = "HEAD";
const GET_METHOD = "GET";
const ONE_SEGMENT = "*";
const ANY_SEGMENTS = "**";
const STAR = "*";
// No allowance segment can be empty, so this token never equals one.
const CATCH_ALL_SEGMENT = "";
const PARAM_SEGMENT: ScopeSegment = { kind: "param" };
const CATCH_ALL: ScopeSegment = { kind: "catch-all" };
// Route syntax of the Node frameworks: params, groups and patterns, optional and repeated parts, escapes.
const ROUTE_SYNTAX = /[:{}()?+*[\]\\^$|]/;
const ESCAPE = "\\";
const GROUP_OPENINGS = new Set(["(", "{"]);
const GROUP_CLOSINGS = new Set([")", "}"]);
const REPEATED_PART = "+";
// What a param pattern may hold and still keep to one segment once `\d`, `\w` and `(?:` are read: letters,
// digits, `_`, `-`, alternation, groups, quantifiers, anchors and classes.
const ONE_SEGMENT_PATTERN = /^[A-Za-z0-9_|(){},?+*^$[\]-]*$/;
const WORD_CLASS_ESCAPE = /\\[dw]/g;
const NON_CAPTURING_GROUP = "(?:";
const NEGATED_CLASS = "[^";
const CLASS_CONTENT = /\[([^\]]*)\]/g;
const ALPHANUMERIC = /^[A-Za-z0-9]$/;
const RANGE = "-";

/**
 * The listed routes in the check's scope the allow-list does not name, each once; none when the check is off. A
 * `HEAD` route the framework adds beside a `GET` route follows that route.
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

    if (!isInScope(check.scope, route)) continue;

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

// The scope fails closed: a route it cannot read (a regular expression) is checked.
function isInScope(scope: FrameworkRouteScope, route: ListedRoute): boolean {
  if (scope === "strict" || route.pathSyntax === REGULAR_EXPRESSION_PATH) return true;

  const routeSegments = segmentsOf(route.path).map(scopeSegmentOf);

  return scope.basePaths.some((basePath) => overlaps(routeSegments, segmentsOf(basePath)));
}

// Whether a route can serve a path at or under the base path: each of its first segments takes the base path's
// segment (the same literal, a param or a catch-all), and it has at least as many segments, or a catch-all.
function overlaps(
  routeSegments: readonly ScopeSegment[],
  baseSegments: readonly string[],
): boolean {
  for (const [index, baseSegment] of baseSegments.entries()) {
    const routeSegment = routeSegments[index];

    if (routeSegment === undefined) return false;

    if (routeSegment.kind === "catch-all") return true;

    if (
      routeSegment.kind === "literal" &&
      routeSegment.lowerCaseText !== baseSegment.toLowerCase()
    ) {
      return false;
    }
  }

  return true;
}

// Any route syntax makes a segment a param (`:id`, `:from-:to`, `:id{[0-9]+}`, `:id(\d+)`), and a catch-all when it
// may take a `/` or cannot be read: a star, a part repeated over segments (`:rest+`), an unclosed group (the
// Express 5 `{/:id}`, split at its `/`), or a pattern that does not keep to one segment (`:rest{.+}`).
function scopeSegmentOf(segment: string): ScopeSegment {
  if (!ROUTE_SYNTAX.test(segment)) return { kind: "literal", lowerCaseText: segment.toLowerCase() };

  const parts = segmentParts(segment);

  if (parts === undefined) return CATCH_ALL;

  if (parts.outside.includes(STAR) || parts.outside.includes(REPEATED_PART)) return CATCH_ALL;

  return parts.patterns.every(patternKeepsToOneSegment) ? PARAM_SEGMENT : CATCH_ALL;
}

// The segment's text outside groups, and the content of each outermost `(...)` or `{...}`; undefined when a group is
// not closed or closes without opening.
function segmentParts(segment: string): { outside: string; patterns: string[] } | undefined {
  const patterns: string[] = [];
  let outside = "";
  let current = "";
  let depth = 0;
  let escaped = false;

  for (const character of segment) {
    if (escaped || character === ESCAPE) {
      escaped = !escaped;
    } else if (GROUP_OPENINGS.has(character)) {
      depth += 1;

      if (depth === 1) continue;
    } else if (GROUP_CLOSINGS.has(character)) {
      depth -= 1;

      if (depth < 0) return undefined;

      if (depth === 0) {
        patterns.push(current);
        current = "";
        continue;
      }
    }

    if (depth === 0) outside += character;
    else current += character;
  }

  return depth === 0 ? { outside, patterns } : undefined;
}

// Read conservatively: a pattern keeps to one segment only when it holds no `.`, no `/`, no escape but `\d` and
// `\w`, no negated class and no class range that can reach `/`.
function patternKeepsToOneSegment(pattern: string): boolean {
  const read = pattern.replaceAll(WORD_CLASS_ESCAPE, "0").replaceAll(NON_CAPTURING_GROUP, "(");

  if (read.includes(NEGATED_CLASS) || !ONE_SEGMENT_PATTERN.test(read)) return false;

  return [...read.matchAll(CLASS_CONTENT)].every((match) =>
    classRangesKeepToAlphanumerics(match[1] ?? ""),
  );
}

// A `-` inside a class is a range between two letters or digits, which never reaches `/`, or a literal at its edge.
function classRangesKeepToAlphanumerics(content: string): boolean {
  return [...content].every((character, index) => {
    if (character !== RANGE || index === 0 || index === content.length - 1) return true;

    return (
      ALPHANUMERIC.test(content[index - 1] ?? "") && ALPHANUMERIC.test(content[index + 1] ?? "")
    );
  });
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
