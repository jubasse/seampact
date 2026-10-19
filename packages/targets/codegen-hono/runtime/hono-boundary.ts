// The Hono placement of the shared request checks (ADR 0020): `registerRoutes` wraps the app's `fetch` once with a
// request slot and the outgoing check, adds one route per operation, most specific first, whose handler runs every
// step from the media type and the bounded body read to the handler's reply, then the catch-alls of the contract
// paths and base paths; the boot check; and the exported helpers for the app's `onError` and middleware. Each api's
// generated module calls `createHonoBoundary` once with its route table.
import type { Context, Env, Hono, Next, Schema } from "hono";
import { authorizeRequest, type CheckState } from "./web-server/access-checks.js";
import {
  basePathClaimsOf,
  claimsBasePathAlone,
  registerBasePathClaim,
} from "./web-server/base-path-claims.js";
import { type BoundaryContext, boundaryContext } from "./web-server/boundary-context.js";
import {
  type BootProblem,
  type BoundaryHooks,
  bootProblemsMessage,
  hookBootProblems,
} from "./web-server/boundary-hooks.js";
import {
  ContractError,
  type ContractReply,
  renderContractReply,
  unexpectedError,
} from "./web-server/contract-error.js";
import {
  type ContractApi,
  type ContractRequest,
  type ContractRoute,
  matchContractRoute,
  matchesContractPath,
} from "./web-server/contract-route.js";
import {
  frameworkRefusal,
  isStatusDenial,
  notFoundError,
  type ReportedRequest,
  reportContractError,
} from "./web-server/error-reply.js";
import {
  type HandlerBindings,
  handlerResultReply,
  type RegistrationOptions,
  type ResponseSettings,
  registrationProblems,
  runInputSteps,
  settingsOf,
} from "./web-server/handler-map.js";
import { mediaTypeRefusal, type PlatformFixes } from "./web-server/transport-checks.js";
import { checkOutgoingResponse, recordBoundaryResponse } from "./web-server/web-outgoing-check.js";
import {
  readContractBody,
  type ReadRequestBody,
  webContractRequest,
  webReportedRequest,
} from "./web-server/web-request.js";
import {
  claimFetchWrap,
  currentRequestSlot,
  type RequestSlot,
  servedInRequestSlot,
} from "./web-server/web-request-slot.js";
import {
  errorResponse,
  notServedResponse,
  replaceReplyHeaders,
  settledContractResponse,
} from "./web-server/web-response.js";

const SKIP_CONTRACT_ROUTES_FIX =
  "Skip contract routes in the app middleware that reads the body, with isContractRoute(c): the boundary reads it itself.";
const HONO_FIXES: PlatformFixes = {
  rawBody: SKIP_CONTRACT_ROUTES_FIX,
  bodySize: SKIP_CONTRACT_ROUTES_FIX,
};
const ROOT_BASE_PATH = "/";
const NO_BODY: ReadRequestBody = { body: undefined };

/** The registration options of one api on a Hono app: the shared ones and the client address of a request. */
export interface HonoRegistrationOptions<Hooks, Handlers, Operation extends string, E extends Env>
  extends RegistrationOptions<Hooks, Handlers, Operation> {
  /** The client's address, which a `Request` does not carry, such as `getConnInfo(c).remote.address`. */
  readonly clientAddress?: (c: Context<E>) => string | undefined;
}

/** The Hono boundary of one api. */
export function createHonoBoundary<Hooks extends BoundaryHooks, Handlers, Operation extends string>(
  api: ContractApi,
  generated: ResponseSettings,
  bindings: HandlerBindings,
) {
  // The context of this api's contract request in each request slot, for `renderContractError`.
  const contexts = new WeakMap<RequestSlot, BoundaryContext>();
  // The hooks of the last registration, for the replies written outside a contract request.
  const registered: { hooks?: BoundaryHooks } = {};
  // The apps the api is registered on: one registration per app.
  const registeredApps = new WeakSet<object>();

  /** Registers the api's routes on the app that serves, wraps its `fetch` once; runs the boot check. */
  function registerRoutes<E extends Env, S extends Schema, BasePath extends string>(
    app: Hono<E, S, BasePath>,
    options: HonoRegistrationOptions<Hooks, Handlers, Operation, E>,
  ): void {
    const problems = [
      ...hookBootProblems(api, options.hooks),
      ...registrationProblems(api, bindings, options, generated),
      ...optionProblems(options),
    ];

    if (registeredApps.has(app)) {
      problems.push({
        problem: `the api '${api.id}' is registered twice on this app`,
        fix: "call registerRoutes once per api on an app",
      });

      throw new Error(bootProblemsMessage(api, problems));
    }

    const firstAddedRoute = app.routes.length;

    for (const route of api.routes) {
      const settings = settingsOf(route, bindings, options, generated);

      app.on(route.method.toUpperCase(), honoPath(route.path), (c, next) =>
        serveContractRoute(app, c, next, route, settings, options),
      );
    }

    registerCatchAlls(app);
    problems.push(...basePathProblems(app.routes.slice(firstAddedRoute)));

    if (problems.length > 0) throw new Error(bootProblemsMessage(api, problems));

    registeredApps.add(app);
    registerBasePathClaim(app, api);
    registered.hooks = options.hooks;

    if (claimFetchWrap(app)) {
      const servedFetch = app.fetch;

      app.fetch = (request, env, executionContext) =>
        servedInRequestSlot(() => servedFetch(request, env, executionContext));
    }
  }

  // One catch-all per contract path for a method it does not serve, then one per base path, which Hono also matches
  // on the base path itself.
  function registerCatchAlls<E extends Env, S extends Schema, BasePath extends string>(
    app: Hono<E, S, BasePath>,
  ): void {
    const contractPaths = new Set(api.routes.map((route) => honoPath(route.path)));
    const basePaths = api.basePaths.filter((basePath) => basePath !== "");

    for (const path of [...contractPaths, ...basePaths.map((basePath) => `${basePath}/*`)]) {
      app.all(path, (c, next) => unservedOrNext(app, c.req.raw, next));
    }
  }

  // A path under a base path the api alone claims, or a contract path the method misses, answers the api's 404; a
  // base path another api of the app also claims is left to the app.
  async function unservedOrNext(
    app: object,
    request: Request,
    next: Next,
  ): Promise<Response | undefined> {
    const reported = webReportedRequest(request);

    if (
      !matchesContractPath(api, reported.path) &&
      !claimsBasePathAlone(api, basePathClaimsOf(app), reported.path)
    ) {
      await next();

      return undefined;
    }

    return notServedResponse(registered.hooks, api, reported);
  }

  async function serveContractRoute<E extends Env>(
    app: object,
    c: Context<E>,
    next: Next,
    route: ContractRoute,
    settings: ResponseSettings,
    options: HonoRegistrationOptions<Hooks, Handlers, Operation, E>,
  ): Promise<Response | undefined> {
    const reported = webReportedRequest(c.req.raw);
    const matched = matchContractRoute(api, reported.method, reported.path);

    // A path only Hono's decoding or relaxed routing leads here: the raw path is not this operation's, so no
    // handler runs under another operation's access and input.
    if (matched === undefined) return unservedOrNext(app, c.req.raw, next);

    if (matched.route.id !== route.id) {
      return errorResponse(
        undefined,
        options.hooks,
        api,
        matched.route,
        notFoundError(matched.route),
        reported,
      );
    }

    const slot = currentRequestSlot();

    // Fail closed: without the wrapped `fetch`, the reply would go out unchecked.
    if (slot === undefined) {
      return errorResponse(
        undefined,
        options.hooks,
        api,
        route,
        unexpectedError(
          route,
          new Error(
            `seampact: a contract route of api '${api.id}' ran outside the app's wrapped fetch; call registerRoutes on the app that serves, before reading its fetch, and not on a sub-app mounted with app.route().`,
          ),
        ),
        reported,
      );
    }

    const context: BoundaryContext = {
      api,
      route,
      pathParams: matched.pathParams,
      hooks: options.hooks,
      bodyValidation: settings.bodyValidation,
      mode: settings.responses,
      boundaryWriting: false,
    };

    contexts.set(slot, context);
    slot.outgoing = (response) => checkOutgoingResponse(context, reported, response);

    return boundaryContext.run(context, () => runSteps(c, context, options, reported));
  }

  // Steps 1 to 10 of one contract request; a refusal the api answers is its reply, anything else is kept for
  // `onUnexpectedError` and rethrown to the app's `onError`.
  async function runSteps<E extends Env>(
    c: Context<E>,
    context: BoundaryContext,
    options: HonoRegistrationOptions<Hooks, Handlers, Operation, E>,
    reported: ReportedRequest,
  ): Promise<Response> {
    const route = context.route;
    const binding = bindings[route.id];

    try {
      if (binding === undefined) {
        throw unexpectedError(route, new Error(`seampact: '${route.id}' has no handler binding`));
      }

      const request = c.req.raw;
      const mediaRefusal = mediaTypeRefusal(route, webContractRequest(request, NO_BODY, undefined));

      if (mediaRefusal !== undefined) throw mediaRefusal;

      const read = await readContractBody(route, request, SKIP_CONTRACT_ROUTES_FIX);
      const state = checkState(
        context,
        webContractRequest(request, read, options.clientAddress?.(c)),
      );

      context.grant = await authorizeRequest(state);

      const started = await runInputSteps(state, context);
      const reply =
        started?.replay ?? (await handlerResultReply(state, context, options.handlers, binding));

      return await answer(c, context, reply);
    } catch (error) {
      const claimed = claimedError(route, error);

      if (claimed === undefined) {
        context.unclaimedException = error;

        throw error;
      }

      await reportContractError(context.hooks, api, route, claimed, reported);

      return answer(c, context, renderContractReply(api, route, claimed));
    }
  }

  // The boundary's reply becomes `c.res`, which merges the headers middleware set before `next()` and lets them
  // replace the reply's own: its names are set again, `Vary` merged, and that object is recorded as the boundary's.
  async function answer<E extends Env>(
    c: Context<E>,
    context: BoundaryContext,
    reply: ContractReply,
  ): Promise<Response> {
    const response = await settledContractResponse(context, reply);

    // Reading `c.res` builds Hono's response from the headers set with `c.header()`, so the assignment merges them.
    const appResponse = c.res;

    if (appResponse !== response) c.res = response;

    replaceReplyHeaders(c.res.headers, reply.headers);
    recordBoundaryResponse(context, c.res, reply);

    return c.res;
  }

  function checkState(context: BoundaryContext, request: ContractRequest): CheckState {
    return {
      api: context.api,
      route: context.route,
      request,
      pathParams: context.pathParams,
      hooks: context.hooks,
      isFrameworkDenial: isStatusDenial,
      fixes: HONO_FIXES,
    };
  }

  /** The reply of a contract error, or a 401, 403 or 429 mapped to its role, in the api's format; for `onError`. */
  async function renderContractError(c: Context, error: unknown): Promise<Response> {
    const slot = currentRequestSlot();
    const context = slot === undefined ? undefined : contexts.get(slot);
    const reported = webReportedRequest(c.req.raw);
    const route = context?.route ?? matchContractRoute(api, reported.method, reported.path)?.route;
    const contractError =
      route === undefined
        ? unexpectedError(undefined, error)
        : (claimedError(route, error) ?? unexpectedError(route, error));
    const reply = renderContractReply(api, route, contractError);

    await reportContractError(
      context?.hooks ?? registered.hooks,
      api,
      route,
      contractError,
      reported,
    );

    const response = await settledContractResponse(context, reply);

    if (context !== undefined) recordBoundaryResponse(context, response, reply);

    return response;
  }

  /**
   * The reply, in the api's format, of an error app middleware raised before the boundary (a 401, 403 or 429) on a
   * request a contract route serves; undefined for any other request or error, which the app answers.
   */
  async function renderPreRoutingError(c: Context, error: unknown): Promise<Response | undefined> {
    const slot = currentRequestSlot();

    if (slot !== undefined && contexts.has(slot)) return undefined;

    const reported = webReportedRequest(c.req.raw);
    const matched = matchContractRoute(api, reported.method, reported.path);
    const refusal = matched === undefined ? undefined : frameworkRefusal(matched.route, error);

    if (matched === undefined || refusal === undefined) return undefined;

    return errorResponse(undefined, registered.hooks, api, matched.route, refusal, reported);
  }

  /** True on a request a contract route of the api serves, for app middleware that skips them. */
  function isContractRoute(c: Context): boolean {
    const reported = webReportedRequest(c.req.raw);

    return matchContractRoute(api, reported.method, reported.path) !== undefined;
  }

  return { registerRoutes, renderContractError, renderPreRoutingError, isContractRoute };
}

function claimedError(route: ContractRoute, error: unknown): ContractError | undefined {
  if (error instanceof ContractError) return error;

  return frameworkRefusal(route, error);
}

function optionProblems(options: { readonly clientAddress?: unknown }): BootProblem[] {
  if (options.clientAddress === undefined || typeof options.clientAddress === "function") return [];

  return [
    {
      problem: "'clientAddress' is not a function",
      fix: "pass a function of the request context, such as (c) => getConnInfo(c).remote.address, or leave it out",
    },
  ];
}

// `app.basePath()` prefixes every route the registration adds, which differs from the contract's empty mount.
function basePathProblems(added: readonly { readonly basePath: string }[]): BootProblem[] {
  const basePath = added.find((route) => route.basePath !== ROOT_BASE_PATH)?.basePath;

  if (basePath === undefined) return [];

  return [
    {
      problem: `the app has the base path '${basePath}', which differs from the contract's empty mount`,
      fix: "call registerRoutes on an app without basePath()",
    },
  ];
}

// Hono's syntax with positional param names; a `:` inside a static segment is literal. The generator refuses a
// static segment Hono would read as syntax, and a segment that mixes a placeholder with literal text.
function honoPath(template: string): string {
  let position = 0;

  return template.replace(/\{[^}]+\}/g, () => {
    position += 1;

    return `:p${position}`;
  });
}
