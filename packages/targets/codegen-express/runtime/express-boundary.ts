// The Express placement of the shared request checks (ADR 0018): a router per api with one route per operation,
// most specific first, whose middleware run step 1, the access steps, the input steps and the handler; one
// catch-all per contract path; the router's narrow error middleware; the boot check; and the exported helpers for
// errors raised before the router. The same code serves Express 4 and 5. Each api's generated module calls
// `createExpressBoundary` once with its route table.
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
  type BoundaryHooks,
  bootProblemsMessage,
  hookBootProblems,
} from "./node-server/boundary-hooks.js";
import { ContractError, unexpectedError } from "./node-server/contract-error.js";
import {
  type ContractApi,
  type ContractRoute,
  matchContractPath,
  matchContractRoute,
} from "./node-server/contract-route.js";
import {
  frameworkRefusal,
  isStatusDenial,
  logWriteFailure,
  notFoundError,
  type ReportedRequest,
  respondWithError,
} from "./node-server/error-reply.js";
import {
  bodyParserRefusal,
  contractRequest,
  type ExpressRequest,
  expressBodyGlue,
  pathnameOf,
} from "./node-server/express-platform.js";
import {
  type HandlerBindings,
  handlerResultReply,
  type RegistrationOptions,
  type ResponseSettings,
  registrationProblems,
  runInputSteps,
  settingsOf,
} from "./node-server/handler-map.js";
import {
  type BoundaryContext,
  boundaryContext,
  installOutgoingCheck,
  writeContractReply,
} from "./node-server/outgoing-check.js";
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
const DEFAULT_METHOD = "GET";
const NO_MOUNT = "";

type ContinueOrStop = "continue" | "stop";

/** The Express boundary of one api. */
export function createExpressBoundary<Hooks extends BoundaryHooks, Handlers>(
  api: ContractApi,
  generated: ResponseSettings,
  bindings: HandlerBindings,
) {
  const bodyGlue = expressBodyGlue(api);
  // The context of each contract response, for the error middleware and `renderContractError`.
  const contexts = new WeakMap<ServerResponse, BoundaryContext>();
  // The hooks of the last router made, for the replies written outside a request context.
  const registered: { hooks?: BoundaryHooks } = {};
  const warnedGlobalParser = new Set<string>();

  function router<Operation extends string>(
    options: RegistrationOptions<Hooks, Handlers, Operation>,
  ): Router {
    const problems = [
      ...hookBootProblems(api, options.hooks),
      ...registrationProblems(api, bindings, options, generated),
    ];

    if (problems.length > 0) throw new Error(bootProblemsMessage(api, problems));

    registered.hooks = options.hooks;

    const contractRouter = express.Router();

    for (const route of api.routes) {
      contractRouter[methodOf(route)](routePattern(route.path), ...routeMiddleware(route, options));
    }

    for (const path of new Set(api.routes.map((route) => route.path))) {
      contractRouter.all(routePattern(path), unservedMethod(path, options.hooks));
    }

    contractRouter.use(contractErrorMiddleware);

    return contractRouter;
  }

  function routeMiddleware(
    route: ContractRoute,
    options: RegistrationOptions<Hooks, Handlers, string>,
  ): RequestHandler[] {
    const settings = settingsOf(route, bindings, options, generated);
    const binding = bindings[route.id];
    const enter: RequestHandler = (request, response, next) => {
      enterRoute(route, settings, options.hooks, request, response, next);
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

    // HEAD runs through the GET route's middleware; the contract serves no HEAD.
    if (matched === undefined) {
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
        parser(request, response, next);

        return;
      }

      if (!warnedGlobalParser.has(route.id)) {
        warnedGlobalParser.add(route.id);
        console.warn(
          `seampact: an app-wide body parser read the body of '${route.id}' before the router of api '${api.id}'; mount the router before it, or give it verify: keepRawBody and limit: LARGEST_BODY_LIMIT.`,
        );
      }

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

  // A method the contract path does not serve, OPTIONS included: the path's 404.
  function unservedMethod(path: string, hooks: BoundaryHooks): RequestHandler {
    const route = api.routes.find((candidate) => candidate.path === path);

    return (request, response) => {
      const reported = reportedRequest(request);

      if (request.baseUrl !== NO_MOUNT) {
        respondMounted(request, response, route, hooks, reported);

        return;
      }

      respondDetached(response, hooks, route, notFoundError(route), reported);
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

  /** Writes a contract error, or a framework refusal mapped to its role, in the api's format. */
  function renderContractError(response: ServerResponse, error: unknown): Promise<void> {
    const context = contexts.get(response);
    const route = context?.route;
    const contractError =
      route === undefined
        ? unexpectedError(undefined, error)
        : (claimedError(route, error) ?? unexpectedError(route, error));
    const request: IncomingMessage | undefined = response.req;

    return respondWithError(
      response,
      context,
      context?.hooks ?? registered.hooks,
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

    if (route === undefined) return false;

    const contractError =
      error === undefined
        ? notFoundError(route)
        : (bodyParserRefusal(route, error) ?? frameworkRefusal(route, error));

    if (contractError === undefined) return false;

    respondDetached(response, registered.hooks, route, contractError, reported);

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

  return {
    router,
    preRoutingErrorHandler,
    renderPreRoutingError,
    renderContractError,
    isContractRoute,
    keepRawBody: bodyGlue.keepRawBody,
  };
}

function claimedError(route: ContractRoute, error: unknown): ContractError | undefined {
  if (error instanceof ContractError) return error;

  return bodyParserRefusal(route, error) ?? frameworkRefusal(route, error);
}

function reportedRequest(request: ExpressRequest): ReportedRequest {
  return { method: request.method ?? DEFAULT_METHOD, path: pathnameOf(request) };
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
