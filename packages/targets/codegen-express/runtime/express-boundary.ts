// The Express placement of the shared request checks (ADR 0018): a router per api with one route per operation,
// most specific first, whose middleware run step 1, the access steps, the input steps and the handler; one
// catch-all per contract path and one for the api's base paths; the router's narrow error middleware; the boot
// check; the framework-route check, which the app calls before listening or the router runs on the first request;
// and the exported helpers for errors raised before the router. The same code serves Express 4 and 5. Each api's
// generated module calls `createExpressBoundary` once with its route table.
import type { IncomingMessage, ServerResponse } from "node:http";
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type Router,
} from "express";
import { authorizeRequest, type CheckState } from "./node-server/access-checks.js";
import {
  type BasePathClaim,
  basePathClaimsOf,
  claimsBasePathAlone,
  registerBasePathClaim,
} from "./node-server/base-path-claims.js";
import { type BoundaryContext, boundaryContext } from "./node-server/boundary-context.js";
import {
  type BootProblem,
  type BoundaryHooks,
  bootProblemsMessage,
  type HooksRequirement,
  hookBootProblems,
  type RegisteredHooks,
  resolvedHooks,
} from "./node-server/boundary-hooks.js";
import { ContractError, unexpectedError } from "./node-server/contract-error.js";
import {
  type ContractApi,
  type ContractRoute,
  isUnderBasePath,
  matchContractPath,
  matchContractRoute,
  matchesContractPath,
} from "./node-server/contract-route.js";
import {
  frameworkRefusal,
  isStatusDenial,
  logWriteFailure,
  notFoundError,
  type ReportedRequest,
} from "./node-server/error-reply.js";
import { frameworkRouteProblems } from "./node-server/framework-routes.js";
import {
  type HandlerBindings,
  handlerResultReply,
  type RegistrationOptions,
  type ResponseSettings,
  registrationProblems,
  runInputSteps,
  settingsOf,
} from "./node-server/handler-map.js";
import { expressRouteListing, isObjectLike } from "./node-server/node-express-routes.js";
import { installOutgoingCheck } from "./node-server/node-outgoing-check.js";
import {
  respondNotServed,
  respondWithError,
  writeContractReply,
} from "./node-server/node-reply.js";
import {
  bodyParserRefusal,
  clearEmptyBody,
  contractRequest,
  DEFAULT_METHOD,
  type ExpressRequest,
  expressBodyGlue,
  ownBodyParserRefusal,
  reportedRequest,
} from "./node-server/node-request.js";
import {
  bodySizeRefusal,
  mediaTypeRefusal,
  type PlatformFixes,
} from "./node-server/transport-checks.js";

const EXPRESS_FIXES: PlatformFixes = {
  rawBody:
    "Mount the router before any app-wide JSON parser, or give that parser the generated keepRawBody as its verify function.",
  bodySize:
    "Mount the router before any app-wide JSON parser, or give that parser the generated keepRawBody as its verify function.",
};
const NO_MOUNT = "";

type ContinueOrStop = "continue" | "stop";

/** The Express boundary of one api. */
export function createExpressBoundary<Hooks extends RegisteredHooks, Handlers>(
  api: ContractApi,
  generated: ResponseSettings,
  bindings: HandlerBindings,
) {
  const bodyGlue = expressBodyGlue(api);
  // The context of each contract response, for the error middleware and `renderContractError`.
  const contexts = new WeakMap<ServerResponse, BoundaryContext>();
  // The hooks of each router made, for the replies written outside a request context.
  const routerHooks = new WeakMap<object, BoundaryHooks>();
  const routersMade: { count: number; lastHooks?: BoundaryHooks } = { count: 0 };
  const warnedGlobalParser = new Set<string>();
  // The framework-route check's problems per app, once it has run: on the app's call or on its first request.
  const frameworkRouteResults = new WeakMap<object, readonly BootProblem[]>();

  function router<Operation extends string>(
    options: RegistrationOptions<Hooks, Handlers, Operation> & HooksRequirement<Hooks>,
  ): Router {
    const hooks = resolvedHooks(options.hooks);
    const problems = [
      ...hookBootProblems(api, hooks),
      ...registrationProblems(api, bindings, options, generated),
    ];

    if (problems.length > 0) throw new Error(bootProblemsMessage(api, problems));

    const contractRouter = express.Router();

    routerHooks.set(contractRouter, hooks);
    routersMade.count += 1;
    routersMade.lastHooks = hooks;

    if (api.frameworkRoutes.status === "on") {
      contractRouter.use(uncheckedFrameworkRoutesGuard(hooks));
    }

    for (const route of api.routes) {
      contractRouter[methodOf(route)](
        routePattern(route.path),
        ...routeMiddleware(route, options, hooks),
      );
    }

    for (const path of new Set(api.routes.map((route) => route.path))) {
      contractRouter.all(routePattern(path), unservedMethod(path, hooks));
    }

    contractRouter.use(unservedBasePath(hooks));
    registerBasePathClaim(contractRouter, api);

    contractRouter.use(contractErrorMiddleware);

    return contractRouter;
  }

  function routeMiddleware(
    route: ContractRoute,
    options: RegistrationOptions<Hooks, Handlers, string>,
    hooks: BoundaryHooks,
  ): RequestHandler[] {
    const settings = settingsOf(route, bindings, options, generated);
    const binding = bindings[route.id];
    const enter: RequestHandler = (request, response, next) => {
      enterRoute(route, settings, hooks, request, response, next);
    };

    const access = step(async (request, _response, context) => {
      context.grant = await authorizeRequest(checkState(context, request));

      return "continue";
    });
    const input = step(async (request, response, context) => {
      const started = await runInputSteps(checkState(context, request), context);

      if (started === undefined) return "continue";

      await writeContractReply(response, context, started.replay);

      return "stop";
    });
    const handler = step(async (request, response, context) => {
      if (binding === undefined) {
        throw unexpectedError(route, new Error(`seampact: '${route.id}' has no handler binding`));
      }

      const reply = await handlerResultReply(
        checkState(context, request),
        context,
        options.handlers,
        binding,
      );

      await writeContractReply(response, context, reply);

      return "stop";
    });

    return [enter, ...bodyMiddleware(route), access, input, handler];
  }

  // Step 1 before the body: the mount, the request context, the outgoing check and the media type.
  function enterRoute(
    route: ContractRoute,
    settings: ResponseSettings,
    hooks: BoundaryHooks,
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    const reported = reportedRequest(request);

    if (request.baseUrl !== NO_MOUNT) {
      respondMounted(request, response, route, hooks, reported);

      return;
    }

    const matched = matchContractRoute(api, reported.method, reported.path);

    // A method the route's path does not serve, though Express routed it here.
    if (matched === undefined && matchesContractPath(api, reported.path)) {
      respondUnserved(response, hooks, reported);

      return;
    }

    // A request Express routed to another operation than the raw path names is refused too, so no handler runs
    // under another's checks.
    if (matched === undefined || matched.route.id !== route.id) {
      respondDetached(response, hooks, route, notFoundError(route), reported);

      return;
    }

    const context: BoundaryContext = {
      api,
      route: matched.route,
      pathParams: matched.pathParams,
      hooks,
      bodyValidation: settings.bodyValidation,
      mode: settings.responses,
      boundaryWriting: false,
    };

    contexts.set(response, context);
    installOutgoingCheck(response, context, reported);
    boundaryContext.run(context, () => {
      const refusal = mediaTypeRefusal(matched.route, contractRequest(request));

      next(refusal);
    });
  }

  // The route's own JSON parser, at the route's limit, then the body-limit check on the parsed byte count.
  function bodyMiddleware(route: ContractRoute): RequestHandler[] {
    const input = route.input;

    if (input === undefined) return [];

    const parser = express.json({
      limit: input.limitBytes,
      strict: false,
      type: () => true,
      verify: bodyGlue.keepRawBody,
    });
    const sizeCheck: RequestHandler = (request, _response, next) => {
      const recorded = bodyGlue.recordedBodyBytes(request);

      next(
        bodySizeRefusal(route, contractRequest(request), {
          ...(recorded === undefined ? {} : { recordedBytes: recorded }),
          fixes: EXPRESS_FIXES,
        }),
      );
    };

    const parse: RequestHandler = (request, response, next) => {
      if (!request.readableEnded) {
        parser(request, response, (error?: unknown) => {
          if (error !== undefined) {
            next(ownBodyParserRefusal(route, error) ?? error);

            return;
          }

          // The route's own parser records every body it reads, so nothing recorded is no body.
          clearEmptyBody(request, bodyGlue.recordedBodyBytes(request) ?? 0);
          next();
        });

        return;
      }

      if (!warnedGlobalParser.has(route.id)) {
        warnedGlobalParser.add(route.id);
        console.warn(
          `seampact: an app-wide body parser read the body of '${route.id}' before the router of api '${api.id}'; mount the router before it, or give it verify: keepRawBody and limit: LARGEST_BODY_LIMIT.`,
        );
      }

      clearEmptyBody(request, bodyGlue.recordedBodyBytes(request));
      next();
    };

    return [parse, sizeCheck];
  }

  // Runs a step in the request context; a rejection goes to the router's error middleware, on Express 4 as on 5.
  function step(
    run: (
      request: Request,
      response: Response,
      context: BoundaryContext,
    ) => Promise<ContinueOrStop>,
  ): RequestHandler {
    return (request, response, next) => {
      const context = contexts.get(response);

      if (context === undefined) {
        next(
          new Error(
            `seampact: a route of api '${api.id}' ran without its request context; mount the generated router as a whole.`,
          ),
        );

        return;
      }

      boundaryContext.run(context, () => {
        run(request, response, context).then((outcome) => {
          if (outcome === "continue") next();
        }, next);
      });
    };
  }

  function checkState(context: BoundaryContext, request: ExpressRequest): CheckState {
    return {
      api: context.api,
      route: context.route,
      request: contractRequest(request),
      pathParams: context.pathParams,
      hooks: context.hooks,
      isFrameworkDenial: isStatusDenial,
      fixes: EXPRESS_FIXES,
    };
  }

  // An app that never called `checkFrameworkRoutes` is checked on its first request; with problems, every request
  // the router receives answers 500 and logs them, so an unchecked app never serves.
  function uncheckedFrameworkRoutesGuard(hooks: BoundaryHooks): RequestHandler {
    return (request, response, next) => {
      const problems = checkedFrameworkRouteProblems(rootAppOf(request.app));

      if (problems.length === 0) {
        next();

        return;
      }

      const reported = reportedRequest(request);
      const route = matchContractPath(api, reported.method, reported.path)?.route;
      const cause = new Error(
        `${bootProblemsMessage(api, problems)}\nThe check ran on the first request, since the app did not call checkFrameworkRoutes(app) before listening; every request answers 500 until the app restarts.`,
      );

      console.error(cause.message);
      respondDetached(response, hooks, route, unexpectedError(route, cause), reported);
    };
  }

  // A method the contract path does not serve, OPTIONS included: the path's 404.
  function unservedMethod(path: string, hooks: BoundaryHooks): RequestHandler {
    const route = api.routes.find((candidate) => candidate.path === path);

    return (request, response) => {
      const reported = reportedRequest(request);

      if (request.baseUrl !== NO_MOUNT) {
        respondMounted(request, response, route, hooks, reported);

        return;
      }

      respondUnserved(response, hooks, reported);
    };
  }

  // A router mounted under a path answers 500 for any request it receives. Otherwise a path under the api's base path
  // that no route serves exactly (a trailing slash, `//`, a percent-encoded static segment, an unknown sub-path) is
  // the api's 404; any other path is the app's, and so is a path that another api's router mounted on the app also
  // claims, which may serve it.
  function unservedBasePath(hooks: BoundaryHooks): RequestHandler {
    return (request, response, next) => {
      const reported = reportedRequest(request);

      if (request.baseUrl !== NO_MOUNT) {
        respondMounted(request, response, undefined, hooks, reported);

        return;
      }

      if (!claimsAlone(api, request.app, reported.path)) {
        next();

        return;
      }

      respondUnserved(response, hooks, reported);
    };
  }

  // A contract error, a parser refusal or a framework 401, 403 or 429 is answered; anything else is the app's.
  const contractErrorMiddleware: ErrorRequestHandler = (error, request, response, next) => {
    const context = contexts.get(response);

    if (context === undefined) {
      next(error);

      return;
    }

    const claimed = claimedError(context.route, error);

    if (claimed === undefined) {
      // The outgoing check reports this exception if the app's reply violates the contract.
      context.unclaimedException = error;
      next(error);

      return;
    }

    respondWithError(
      response,
      context,
      context.hooks,
      api,
      context.route,
      claimed,
      reportedRequest(request),
    ).catch((failure: unknown) => logWriteFailure(api, failure));
  };

  function respondMounted(
    request: Request,
    response: ServerResponse,
    route: ContractRoute | undefined,
    hooks: BoundaryHooks,
    reported: ReportedRequest,
  ): void {
    const cause = new Error(
      `seampact: the router of api '${api.id}' is mounted under '${request.baseUrl}', which differs from the contract's empty mount; mount it at the app's root with app.use(router).`,
    );

    console.error(cause.message);
    respondDetached(response, hooks, route, unexpectedError(route, cause), reported);
  }

  function respondUnserved(
    response: ServerResponse,
    hooks: BoundaryHooks | undefined,
    reported: ReportedRequest,
  ): void {
    respondNotServed(response, hooks, api, reported).catch((failure: unknown) =>
      logWriteFailure(api, failure),
    );
  }

  function respondDetached(
    response: ServerResponse,
    hooks: BoundaryHooks | undefined,
    route: ContractRoute | undefined,
    error: ContractError,
    reported: ReportedRequest,
  ): void {
    respondWithError(response, undefined, hooks, api, route, error, reported).catch(
      (failure: unknown) => logWriteFailure(api, failure),
    );
  }

  /**
   * The hooks of the router that answers a request outside a request context: the first router of this api in the
   * stack of the request's app, nested routers included, since it runs before any later one. Without one found, the
   * only router the api made; with several and none reachable, no hooks, logged by name.
   */
  function owningHooks(request: IncomingMessage | undefined): BoundaryHooks | undefined {
    const app: unknown = request === undefined ? undefined : Reflect.get(request, "app");
    const owner = nestedRouterHandles(app).find((handle) => routerHooks.has(handle));
    const ownerHooks = owner === undefined ? undefined : routerHooks.get(owner);

    if (ownerHooks !== undefined) return ownerHooks;

    if (routersMade.count === 1) return routersMade.lastHooks;

    console.error(noOwningRouterMessage(api, routersMade.count));

    return undefined;
  }

  /** Writes a contract error, or a framework refusal mapped to its role, in the api's format; never rejects. */
  async function renderContractError(response: ServerResponse, error: unknown): Promise<void> {
    try {
      await writeContractError(response, error);
    } catch (failure: unknown) {
      logWriteFailure(api, failure);
    }
  }

  async function writeContractError(response: ServerResponse, error: unknown): Promise<void> {
    const context = contexts.get(response);
    const route = context?.route;
    const contractError =
      route === undefined
        ? unexpectedError(undefined, error)
        : (claimedError(route, error) ?? unexpectedError(route, error));
    const request: IncomingMessage | undefined = response.req;

    await respondWithError(
      response,
      context,
      context?.hooks ?? owningHooks(request),
      api,
      route,
      contractError,
      request === undefined ? { method: DEFAULT_METHOD, path: "" } : reportedRequest(request),
    );
  }

  /**
   * Renders, on a contract path outside the boundary, a body-parser refusal, a 401, 403 or 429, or without an
   * error the path's 404; false when it does nothing.
   */
  function renderPreRoutingError(
    request: IncomingMessage,
    response: ServerResponse,
    error?: unknown,
  ): boolean {
    if (contexts.has(response) || boundaryContext.getStore() !== undefined) return false;

    const reported = reportedRequest(request);

    const route = matchContractPath(api, reported.method, reported.path)?.route;

    if (
      route === undefined &&
      error === undefined &&
      claimsAlone(api, Reflect.get(request, "app"), reported.path)
    ) {
      respondUnserved(response, owningHooks(request), reported);

      return true;
    }

    if (route === undefined) return false;

    if (
      error === undefined &&
      matchContractRoute(api, reported.method, reported.path) === undefined
    ) {
      respondUnserved(response, owningHooks(request), reported);

      return true;
    }

    const contractError =
      error === undefined
        ? notFoundError(route)
        : (bodyParserRefusal(route, error) ?? frameworkRefusal(route, error));

    if (contractError === undefined) return false;

    respondDetached(response, owningHooks(request), route, contractError, reported);

    return true;
  }

  /** An error middleware for refusals raised before the router; the app mounts it after the router. */
  const preRoutingErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
    if (!renderPreRoutingError(request, response, error)) next(error);
  };

  /** True on a request a contract route of the api serves, for app middleware that skips them. */
  function isContractRoute(request: IncomingMessage): boolean {
    const reported = reportedRequest(request);

    return matchContractRoute(api, reported.method, reported.path) !== undefined;
  }

  /**
   * The framework-route boot check: every route of the app outside the apis' routers must be allow-listed in the
   * app config. Express has no start hook, so the app calls it once every route is mounted, before it listens.
   */
  function checkFrameworkRoutes(app: unknown): void {
    if (api.frameworkRoutes.status === "off") return;

    const problems = checkedFrameworkRouteProblems(app);

    if (problems.length > 0) throw new Error(bootProblemsMessage(api, problems));
  }

  // Runs the check once per app and keeps its problems; an app that is not an object is checked every time.
  function checkedFrameworkRouteProblems(app: unknown): readonly BootProblem[] {
    const known = isObjectLike(app) ? frameworkRouteResults.get(app) : undefined;

    if (known !== undefined) return known;

    const listing = expressRouteListing(app);
    const problems = [
      ...listing.problems,
      ...frameworkRouteProblems(api.frameworkRoutes, listing.routes),
    ];

    if (isObjectLike(app)) frameworkRouteResults.set(app, problems);

    return problems;
  }

  return {
    router,
    checkFrameworkRoutes,
    preRoutingErrorHandler,
    renderPreRoutingError,
    renderContractError,
    isContractRoute,
    keepRawBody: bodyGlue.keepRawBody,
  };
}

// The app's stack is read only for a path under the api's base paths, so the app's own paths never depend on it.
// A sub-app's `req.app` is the sub-app; Express links each mounted app to the app that mounts it by `parent`.
function rootAppOf(app: unknown): unknown {
  let current = app;
  let parent = parentAppOf(current);

  while (parent !== undefined) {
    current = parent;
    parent = parentAppOf(current);
  }

  return current;
}

function parentAppOf(app: unknown): object | undefined {
  const parent: unknown = isObjectLike(app) ? Reflect.get(app, "parent") : undefined;

  return isObjectLike(parent) ? parent : undefined;
}

function claimsAlone(api: ContractApi, app: unknown, path: string): boolean {
  if (!isUnderBasePath(api, path)) return false;

  return claimsBasePathAlone(api, appBasePathClaims(api, app), path);
}

/**
 * The claims of the contract routers mounted on an app, read from its router's stack, which Express 4 keeps under
 * `_router` and Express 5 under `router`. An app without a stack to read is refused by name: without it, the api
 * cannot tell a base path it claims alone from one another api shares.
 */
function appBasePathClaims(api: ContractApi, app: unknown): BasePathClaim[] {
  const appRouter: unknown = isObjectLike(app)
    ? (Reflect.get(app, "_router") ?? Reflect.get(app, "router"))
    : undefined;
  const stack: unknown = isObjectLike(appRouter) ? Reflect.get(appRouter, "stack") : undefined;

  if (!Array.isArray(stack)) throw new Error(unreadableRouterStackMessage(api));

  return stack.flatMap((layer: unknown) => {
    const handle: unknown = isObjectLike(layer) ? Reflect.get(layer, "handle") : undefined;

    return isObjectLike(handle) ? basePathClaimsOf(handle) : [];
  });
}

/**
 * The handles of an app's router stack and of the routers nested in it, depth first in mount order; a stack that
 * cannot be read yields none, and the caller falls back by name.
 */
function nestedRouterHandles(app: unknown): object[] {
  const appRouter: unknown = isObjectLike(app)
    ? (Reflect.get(app, "_router") ?? Reflect.get(app, "router"))
    : undefined;
  const handles: object[] = [];

  collectStackHandles(appRouter, handles, new Set());

  return handles;
}

function collectStackHandles(router: unknown, handles: object[], visited: Set<object>): void {
  if (!isObjectLike(router) || visited.has(router)) return;

  visited.add(router);

  const stack: unknown = Reflect.get(router, "stack");

  if (!Array.isArray(stack)) return;

  for (const layer of stack) {
    const handle: unknown = isObjectLike(layer) ? Reflect.get(layer, "handle") : undefined;

    if (!isObjectLike(handle)) continue;

    handles.push(handle);
    collectStackHandles(handle, handles, visited);
  }
}

function noOwningRouterMessage(api: ContractApi, routerCount: number): string {
  return (
    `seampact: no router of api '${api.id}' (${routerCount} made) is reachable from the app that received this ` +
    "request, so its reply reports to no hooks. Mount one router of the api on that app with app.use(router(...)), " +
    "directly or in a router mounted on it."
  );
}

function unreadableRouterStackMessage(api: ContractApi): string {
  return (
    `seampact: the router of api '${api.id}' cannot read the router stack of the app it serves ` +
    "(no 'router.stack' or '_router.stack' on req.app), so it cannot tell which base paths another api shares. " +
    "Mount the router on an Express 4 or 5 app with app.use()."
  );
}

function claimedError(route: ContractRoute, error: unknown): ContractError | undefined {
  if (error instanceof ContractError) return error;

  return bodyParserRefusal(route, error) ?? frameworkRefusal(route, error);
}

function methodOf(route: ContractRoute): "get" | "post" | "put" | "patch" | "delete" {
  const method = route.method;

  if (
    method === "get" ||
    method === "post" ||
    method === "put" ||
    method === "patch" ||
    method === "delete"
  ) {
    return method;
  }

  throw new Error(`seampact: the method '${method}' of '${route.id}' has no Express route method.`);
}

// An anchored pattern both majors read alike: each literal escaped, each param a non-capturing segment, so
// Express decodes nothing and a malformed percent-encoding reaches step 6 raw.
function routePattern(template: string): RegExp {
  const source = template
    .split(/\{[^}]+\}/)
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
    .join("(?:[^/]+)");

  return new RegExp(`^${source}$`);
}
