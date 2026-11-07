// The routes of an Express app, for the framework-route boot check (ADR 0012 "The boot check"): the app's own
// routes and those of the routers mounted at its root, without the apis' routers, known by their claims, and without
// the routes a boundary owns, known by their handlers. A router or sub-app mounted below a path is refused by name:
// Express keeps no readable mount path. Express 4 keeps the app's router under `_router`, Express 5 under `router`.
import { basePathClaimsOf } from "./base-path-claims.js";
import type { BootProblem } from "./boundary-hooks.js";
import { type ListedRoute, REGULAR_EXPRESSION_PATH } from "./framework-route-patterns.js";
import { isBoundaryRoute } from "./framework-routes.js";

export interface ExpressRouteListing {
  /** The routes the app and its root routers register outside the apis' routers and the boundary's routes. */
  readonly routes: readonly ListedRoute[];
  readonly problems: readonly BootProblem[];
}

const EXPRESS_ANY_METHOD = "_all";
const ANY_METHOD = "ALL";
const MOUNTED_APP_LAYER = "mounted_app";

interface Listing {
  readonly routes: ListedRoute[];
  readonly problems: BootProblem[];
  readonly isBoundaryOwned: (route: object) => boolean;
}

/**
 * The routes of an Express app outside the apis it mounts, and a problem per mount the listing cannot read. An
 * Express route (`layer.route`) is the boundary's when every handler is marked, or as the target tells.
 */
export function expressRouteListing(
  app: unknown,
  isBoundaryOwned: (route: object) => boolean = isEveryHandlerMarked,
): ExpressRouteListing {
  const listing: Listing = { routes: [], problems: [], isBoundaryOwned };
  const appRouter: unknown = isObjectLike(app)
    ? (Reflect.get(app, "_router") ?? Reflect.get(app, "router"))
    : undefined;

  if (!isObjectLike(appRouter) || !Array.isArray(Reflect.get(appRouter, "stack"))) {
    listing.problems.push({
      problem:
        "the framework-route check cannot read the app's router stack ('router.stack' or '_router.stack')",
      fix: "pass the Express 4 or 5 app itself, or switch the check off with 'artefacts.bootCheck.frameworkRoutes: false'",
    });

    return listing;
  }

  listStack(appRouter, listing, new Set());

  return listing;
}

function listStack(router: object, listing: Listing, visited: Set<object>): void {
  if (visited.has(router)) return;

  visited.add(router);

  const stack: unknown = Reflect.get(router, "stack");

  if (!Array.isArray(stack)) return;

  for (const layer of stack) {
    if (isObjectLike(layer)) listLayer(layer, listing, visited);
  }
}

function listLayer(layer: object, listing: Listing, visited: Set<object>): void {
  const route: unknown = Reflect.get(layer, "route");

  if (isObjectLike(route)) {
    if (!listing.isBoundaryOwned(route)) listing.routes.push(...routeEntries(route));

    return;
  }

  const handle: unknown = Reflect.get(layer, "handle");

  if (isObjectLike(handle) && basePathClaimsOf(handle).length > 0) return;

  const isRouter = isObjectLike(handle) && Array.isArray(Reflect.get(handle, "stack"));
  const isMountedApp = Reflect.get(layer, "name") === MOUNTED_APP_LAYER;

  if (!isRouter && !isMountedApp) return;

  if (isRouter && isRootMount(layer)) {
    listStack(handle, listing, visited);

    return;
  }

  listing.problems.push({
    problem:
      "the app mounts a router or sub-app below a path, whose routes the framework-route check cannot read",
    fix: "mount it at the app's root, or switch the check off with 'artefacts.bootCheck.frameworkRoutes: false'",
  });
}

/** The methods and path of an Express route, as the listing names them. */
export function routeEntries(route: object): ListedRoute[] {
  const methods: unknown = Reflect.get(route, "methods");
  const paths: unknown = Reflect.get(route, "path");
  const pathList = Array.isArray(paths) ? paths : [paths];

  if (!isObjectLike(methods)) return [];

  return Object.keys(methods)
    .filter((method) => Reflect.get(methods, method) === true)
    .flatMap((method) =>
      pathList.map(
        (path: unknown): ListedRoute => ({
          method: method === EXPRESS_ANY_METHOD ? ANY_METHOD : method.toUpperCase(),
          path: String(path),
          ...(path instanceof RegExp ? { pathSyntax: REGULAR_EXPRESSION_PATH } : {}),
        }),
      ),
    );
}

/** Whether every handler of an Express route passes `isOwned`; false for a route without a handler. */
export function everyRouteHandler(route: object, isOwned: (handler: unknown) => boolean): boolean {
  const stack: unknown = Reflect.get(route, "stack");

  if (!Array.isArray(stack) || stack.length === 0) return false;

  return stack.every(
    (layer: unknown) => isObjectLike(layer) && isOwned(Reflect.get(layer, "handle")),
  );
}

function isEveryHandlerMarked(route: object): boolean {
  return everyRouteHandler(route, isBoundaryRoute);
}

// Express 4 marks a root mount with `regexp.fast_slash`, Express 5 with `slash`.
function isRootMount(layer: object): boolean {
  const regexp: unknown = Reflect.get(layer, "regexp");

  return (
    Reflect.get(layer, "slash") === true ||
    (isObjectLike(regexp) && Reflect.get(regexp, "fast_slash") === true)
  );
}

// Express's apps, routers and layers are functions or objects.
export function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
