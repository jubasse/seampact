// The AdonisJS placement of the shared request checks (ADR 0019): the routes of one api, most specific first, each
// with three inline route middleware and a generated route handler, the boot check, and the helpers an app's
// exception handler calls. Each api's generated module calls `createAdonisBoundary` once with its route table.
import type { ServerResponse } from "node:http";
import string from "@adonisjs/core/helpers/string";
import type { HttpContext, Router } from "@adonisjs/core/http";
import app from "@adonisjs/core/services/app";
import {
  type AccessGrant,
  authorizeRequest,
  type CheckState,
} from "./node-server/access-checks.js";
import {
  type BootProblem,
  type BoundaryHooks,
  bootProblemsMessage,
  hookBootProblems,
  reportUnexpected,
} from "./node-server/boundary-hooks.js";
import {
  ContractError,
  codeOfRole,
  codeOfStatus,
  isPlainObject,
  PAYLOAD_TOO_LARGE_ROLE,
  renderContractReply,
  roleError,
  unexpectedError,
} from "./node-server/contract-error.js";
import {
  type ContractApi,
  type ContractRequest,
  type ContractRoute,
  isUnderPrefix,
  matchContractRoute,
  matchesContractPath,
  type ResponsesMode,
} from "./node-server/contract-route.js";
import { requestTarget } from "./node-server/express-platform.js";
import { handlerReply } from "./node-server/handler-reply.js";
import { beginIdempotency } from "./node-server/idempotency.js";
import { checkRestrictedInput, validateRequestInput } from "./node-server/input-checks.js";
import {
  type BoundaryContext,
  boundaryContext,
  installOutgoingCheck,
  writeContractReply,
} from "./node-server/outgoing-check.js";
import { type PlatformFixes, transportRefusal } from "./node-server/transport-checks.js";

/** The target options this api was generated with. */
export interface AdonisBoundaryOptions {
  readonly responses: ResponsesMode;
  readonly bodyValidation: boolean;
}

/** One operation of the api: its contract id, its controller method, and the interface that method belongs to. */
export interface AdonisOperationEntry {
  readonly id: string;
  readonly operation: string;
  readonly endpoints: string;
}

/** A lazy import of a controller module whose default export implements a generated endpoints interface. */
export type LazyController<Endpoints> = () => Promise<{
  readonly default: new (...dependencies: never[]) => Endpoints;
}>;

/** The `responses` mode and response body validation of one operation, over the registration's. */
export interface OperationReplyOptions {
  readonly responses?: ResponsesMode;
  readonly bodyValidation?: boolean;
}

/** What `registerRoutes` takes (ADR 0019 "Registration"). */
export interface RouteRegistration<
  Hooks extends BoundaryHooks,
  Controllers extends object,
  Operation extends string,
> {
  readonly controllers: Controllers;
  readonly hooks: Hooks;
  readonly responses?: ResponsesMode;
  readonly bodyValidation?: boolean;
  readonly operations?: { readonly [Name in Operation]?: OperationReplyOptions };
}

/** The validated input of one operation, read from the request's context. */
export interface OperationAccessor<Input> {
  input(ctx: HttpContext): Input;
}

// The route name kinds of ADR 0019 "Native security layers".
export type RouteAccessKind = "public" | "optional" | "identity" | "signed";

type NextFunction = () => Promise<unknown> | unknown;

const UNAUTHORIZED_ACCESS = { code: "E_UNAUTHORIZED_ACCESS", status: 401 } as const;
const AUTHORIZATION_FAILURE = { code: "E_AUTHORIZATION_FAILURE", status: 403 } as const;
const TOO_MANY_REQUESTS = { code: "E_TOO_MANY_REQUESTS", status: 429 } as const;
const BAD_CSRF_TOKEN = { code: "E_BAD_CSRF_TOKEN", status: 403 } as const;
const ROUTE_NOT_FOUND_CODE = "E_ROUTE_NOT_FOUND";
const ENTITY_TOO_LARGE_CODE = "E_REQUEST_ENTITY_TOO_LARGE";
const BAD_REQUEST = 400;
const STRICT_JSON_REFUSAL = 422;
const NOT_FOUND = 404;
const UNAUTHENTICATED_ROLE = "unauthenticated";
const FORBIDDEN_ROLE = "forbidden";
const NOT_FOUND_ROLE = "notFound";
const CSRF_INVALID_ROLE = "csrfInvalid";
const HEAD_METHOD = "HEAD";
const GET_METHOD = "get";
const UTF8 = "utf8";
const UTF8_ENCODINGS: readonly string[] = ["utf8", "utf-8"];
const BODYPARSER_CONFIG_KEY = "bodyparser";
const PATH_PARAM = /\{([^}]+)\}/g;
const PARAM_SEGMENT = /^\{[^}]+\}$/;
const BODYPARSER_FIX =
  "Register @adonisjs/core/bodyparser_middleware as router middleware in start/kernel.ts and list the route's media type in the bodyparser config's json.types.";
const ADONIS_FIXES: PlatformFixes = { rawBody: BODYPARSER_FIX, bodySize: BODYPARSER_FIX };
const NO_RAW_BODY = new Uint8Array();

/** A framework refusal the boundary maps by its `code` and `status`, without importing its package. */
function isRefusal(error: unknown, refusal: { readonly code: string; readonly status: number }) {
  return (
    error instanceof Error &&
    Reflect.get(error, "code") === refusal.code &&
    Reflect.get(error, "status") === refusal.status
  );
}

function errorCode(error: unknown): unknown {
  return error instanceof Error ? Reflect.get(error, "code") : undefined;
}

function errorStatus(error: unknown): unknown {
  return error instanceof Error ? Reflect.get(error, "status") : undefined;
}

function isFrameworkDenial(error: unknown): boolean {
  return isRefusal(error, UNAUTHORIZED_ACCESS) || isRefusal(error, AUTHORIZATION_FAILURE);
}

/** True for the errors a generated step answers itself; any other error goes on to the app's exception handler. */
function isClaimed(error: unknown): boolean {
  return (
    error instanceof ContractError ||
    isFrameworkDenial(error) ||
    isRefusal(error, TOO_MANY_REQUESTS)
  );
}

function asContractError(route: ContractRoute, error: unknown): ContractError {
  if (error instanceof ContractError) return error;

  const code = isRefusal(error, UNAUTHORIZED_ACCESS)
    ? (codeOfRole(route, UNAUTHENTICATED_ROLE) ?? codeOfStatus(route, UNAUTHORIZED_ACCESS.status))
    : isRefusal(error, AUTHORIZATION_FAILURE)
      ? (codeOfRole(route, FORBIDDEN_ROLE) ?? codeOfStatus(route, AUTHORIZATION_FAILURE.status))
      : isRefusal(error, TOO_MANY_REQUESTS)
        ? codeOfStatus(route, TOO_MANY_REQUESTS.status)
        : undefined;

  return code === undefined ? unexpectedError(route, error) : new ContractError(code);
}

function notFoundError(route: ContractRoute | undefined): ContractError {
  const code =
    route === undefined
      ? undefined
      : (codeOfRole(route, NOT_FOUND_ROLE) ?? codeOfStatus(route, NOT_FOUND));

  return code === undefined
    ? unexpectedError(route, new Error("the contract path has no 404 code to answer"))
    : new ContractError(code);
}

// A refusal raised before the boundary's first middleware, in the route's terms; anything unknown is a 500.
function preRoutingError(route: ContractRoute | undefined, error: unknown): ContractError {
  if (errorCode(error) === ROUTE_NOT_FOUND_CODE) return notFoundError(route);

  if (route === undefined) return unexpectedError(route, error);

  if (isRefusal(error, BAD_CSRF_TOKEN)) {
    const code = codeOfRole(route, CSRF_INVALID_ROLE);

    return code === undefined ? unexpectedError(route, error) : new ContractError(code);
  }

  if (isClaimed(error)) return asContractError(route, error);

  if (errorCode(error) === ENTITY_TOO_LARGE_CODE) {
    return roleError(route, PAYLOAD_TOO_LARGE_ROLE, { limitBytes: route.input?.limitBytes });
  }

  const status = errorStatus(error);

  if (status === BAD_REQUEST || status === STRICT_JSON_REFUSAL) {
    const code = codeOfStatus(route, BAD_REQUEST);

    return code === undefined ? unexpectedError(route, error) : new ContractError(code);
  }

  return unexpectedError(route, error);
}

// Reports an unexpected failure to the hook (or the log), then writes the error in the api's format.
async function respondWithError(
  response: ServerResponse,
  context: BoundaryContext | undefined,
  hooks: BoundaryHooks | undefined,
  api: ContractApi,
  route: ContractRoute | undefined,
  error: ContractError,
  request: { readonly method: string; readonly path: string },
): Promise<void> {
  if (error.unexpectedCause !== undefined) {
    const where = { api: api.id, operation: route?.id, method: request.method, path: request.path };

    if (hooks?.onUnexpectedError === undefined) {
      console.error(
        `seampact: unexpected failure on operation '${where.operation ?? "(none)"}'`,
        error.unexpectedCause,
      );
    }

    await reportUnexpected(hooks, error.unexpectedCause, where);
  }

  await writeContractReply(response, context, renderContractReply(api, route, error));
}

/** Static segments before params at each segment, so a static route is never shadowed by a param route. */
function mostSpecificFirst(left: ContractRoute, right: ContractRoute): number {
  const leftSegments = left.path.split("/");
  const rightSegments = right.path.split("/");
  const shared = Math.min(leftSegments.length, rightSegments.length);

  for (let index = 0; index < shared; index += 1) {
    const leftIsParam = PARAM_SEGMENT.test(leftSegments[index] ?? "");
    const rightIsParam = PARAM_SEGMENT.test(rightSegments[index] ?? "");

    if (leftIsParam !== rightIsParam) return leftIsParam ? 1 : -1;
  }

  return 0;
}

function adonisPath(path: string): string {
  return path.replace(PATH_PARAM, ":$1");
}

function adonisMethods(route: ContractRoute): string[] {
  const method = route.method.toUpperCase();

  // As `router.get` does; the first middleware answers HEAD with the path's 404, since the contract serves none.
  return route.method === GET_METHOD ? [method, HEAD_METHOD] : [method];
}

function accessKindOf(route: ContractRoute): RouteAccessKind {
  if (route.access.kind === "public") return "public";

  if (route.access.signed !== undefined) return "signed";

  return route.access.anonymousAllowed ? "optional" : "identity";
}

function requestLine(ctx: HttpContext): { method: string; path: string; rawQuery: string } {
  const { path, rawQuery } = requestTarget(ctx.request.request);

  return { method: ctx.request.request.method ?? "GET", path, rawQuery };
}

// The bodyparser keeps the decoded body only; the boundary decodes the JSON itself, since `request.body()` may have
// trimmed or nulled its strings (ADR 0019 "Raw body and decoded body").
function decodedBody(route: ContractRoute, raw: string | null): unknown {
  if (route.input === undefined || raw === null || raw === "") return undefined;

  try {
    return JSON.parse(raw);
  } catch (error) {
    const code = codeOfStatus(route, BAD_REQUEST);

    throw code === undefined ? unexpectedError(route, error) : new ContractError(code);
  }
}

function contractRequestOf(ctx: HttpContext, route: ContractRoute): ContractRequest {
  const { method, path, rawQuery } = requestLine(ctx);
  const raw = ctx.request.raw();
  const remoteAddress = ctx.request.request.socket.remoteAddress;

  return {
    method,
    path,
    rawQuery,
    headers: ctx.request.request.headers,
    body: decodedBody(route, raw),
    // The received bytes as far as Adonis keeps them: the decoded string, re-encoded as UTF-8.
    rawBody: raw === null ? NO_RAW_BODY : Buffer.from(raw, UTF8),
    ...(remoteAddress === undefined ? {} : { clientAddress: remoteAddress }),
  };
}

/** The AdonisJS boundary of one api. */
export function createAdonisBoundary<
  Hooks extends BoundaryHooks,
  Controllers extends object,
  Operation extends string,
>(api: ContractApi, options: AdonisBoundaryOptions, entries: readonly AdonisOperationEntry[]) {
  const orderedApi: ContractApi = { ...api, routes: [...api.routes].sort(mostSpecificFirst) };
  const requests = new WeakMap<BoundaryContext, ContractRequest>();
  const inputs = new WeakMap<HttpContext, { readonly id: string; readonly input: unknown }>();
  // Set by `registerRoutes`: the hooks the exported helpers reach outside a request context.
  const registered: { hooks?: BoundaryHooks } = {};

  const entryOf = (id: string): AdonisOperationEntry => {
    const entry = entries.find((candidate) => candidate.id === id);

    if (entry === undefined)
      throw new Error(`seampact: the api '${api.id}' has no operation '${id}'.`);

    return entry;
  };

  const routeNameOf = (route: ContractRoute): string => `${api.id}.${entryOf(route.id).operation}`;

  function checkState(context: BoundaryContext): CheckState {
    const request = requests.get(context);

    if (request === undefined) {
      throw unexpectedError(
        context.route,
        new Error("seampact: the first route middleware did not run"),
      );
    }

    return {
      api: context.api,
      route: context.route,
      request,
      pathParams: context.pathParams,
      hooks: context.hooks,
      isFrameworkDenial,
      fixes: ADONIS_FIXES,
    };
  }

  function requireContext(route: ContractRoute): BoundaryContext {
    const context = boundaryContext.getStore();

    if (context?.route.id !== route.id) {
      throw unexpectedError(
        route,
        new Error(
          `seampact: the route of '${route.id}' ran without its request context; add the api's routes with registerRoutes only.`,
        ),
      );
    }

    return context;
  }

  // Answers an error of a generated step: a claimed one in the api's format, any other to the app's handler.
  async function answerStepError(ctx: HttpContext, context: BoundaryContext, error: unknown) {
    if (!isClaimed(error)) {
      context.unclaimedException = error;

      throw error;
    }

    await respondWithError(
      ctx.response.response,
      context,
      context.hooks,
      api,
      context.route,
      asContractError(context.route, error),
      requestLine(ctx),
    );
  }

  // Step 1 and the request context (ADR 0019 "Placement", middleware 1).
  function openContext(route: ContractRoute, registration: ReplyOptionsOf) {
    return async (ctx: HttpContext, next: NextFunction): Promise<void> => {
      const response = ctx.response.response;
      const { method, path } = requestLine(ctx);
      const hooks = registration.hooks;

      if (method === HEAD_METHOD) {
        await respondWithError(response, undefined, hooks, api, route, notFoundError(route), {
          method,
          path,
        });

        return;
      }

      const matched = matchContractRoute({ ...api, routes: [route] }, route.method, path);

      if (matched === undefined) {
        await respondOffContractPath(response, hooks, route, { method, path });

        return;
      }

      const replyOptions = registration.replyOptionsOf(route);
      const context: BoundaryContext = {
        api,
        route,
        pathParams: matched.pathParams,
        hooks,
        bodyValidation: replyOptions.bodyValidation,
        mode: replyOptions.responses,
        boundaryWriting: false,
      };

      installOutgoingCheck(response, context, { method, path });
      await boundaryContext.run(context, async () => {
        const refusal = await stepOneRefusal(ctx, context);

        if (refusal !== undefined) {
          await respondWithError(response, context, hooks, api, route, refusal, { method, path });

          return;
        }

        await next();
      });
    };
  }

  async function stepOneRefusal(
    ctx: HttpContext,
    context: BoundaryContext,
  ): Promise<ContractError | undefined> {
    const route = context.route;

    try {
      const request = contractRequestOf(ctx, route);

      requests.set(context, request);

      const refusal = transportRefusal(route, request, { fixes: ADONIS_FIXES });

      if (refusal !== undefined) return refusal;

      if (route.input !== undefined && ctx.request.raw() === null && ctx.request.hasBody()) {
        return unexpectedError(
          route,
          new Error(
            `seampact: operation '${route.id}' (${route.method.toUpperCase()} ${route.path}) got a body the bodyparser did not read. ${BODYPARSER_FIX}`,
          ),
        );
      }

      return undefined;
    } catch (error) {
      return error instanceof ContractError ? error : unexpectedError(route, error);
    }
  }

  // The route matched a path the contract template does not: a group prefix, or a path the contract does not
  // serve as sent (a trailing slash), which answers the route's 404.
  async function respondOffContractPath(
    response: ServerResponse,
    hooks: BoundaryHooks,
    route: ContractRoute,
    request: { readonly method: string; readonly path: string },
  ): Promise<void> {
    if (isUnderPrefix(api, request.path)) {
      await respondWithError(
        response,
        undefined,
        hooks,
        api,
        route,
        unexpectedError(
          route,
          new Error(
            `seampact: ${request.method} ${request.path} reached the route of '${route.id}' under another path; a route group's prefix differs from the contract's empty mount. Call registerRoutes outside any router.group() with a prefix.`,
          ),
        ),
        request,
      );

      return;
    }

    await respondWithError(response, undefined, hooks, api, route, notFoundError(route), request);
  }

  // Steps 2 to 5 (middleware 2).
  function authorize(route: ContractRoute) {
    return async (ctx: HttpContext, next: NextFunction): Promise<void> => {
      const context = requireContext(route);

      try {
        context.grant = await authorizeRequest(checkState(context));
      } catch (error) {
        await answerStepError(ctx, context, error);

        return;
      }

      await next();
    };
  }

  // Steps 6 to 8 and the idempotency claim (middleware 3).
  function validate(route: ContractRoute) {
    return async (ctx: HttpContext, next: NextFunction): Promise<void> => {
      const context = requireContext(route);
      let replay: Awaited<ReturnType<typeof beginIdempotency>>;

      try {
        const grant = requireGrant(context);
        const state = checkState(context);
        const input = await checkRestrictedInput(state, grant, await validateRequestInput(state));

        context.input = input;
        inputs.set(ctx, { id: route.id, input });
        replay = await beginIdempotency(state, grant, input);
      } catch (error) {
        await answerStepError(ctx, context, error);

        return;
      }

      if (replay?.outcome === "replay") {
        await writeContractReply(ctx.response.response, context, replay.reply);

        return;
      }

      if (replay?.outcome === "started") context.idempotencyKey = replay.key;

      await next();
    };
  }

  function requireGrant(context: BoundaryContext): AccessGrant {
    if (context.grant === undefined) {
      throw unexpectedError(
        context.route,
        new Error("seampact: the access middleware did not run"),
      );
    }

    return context.grant;
  }

  // The route handler: the controller's method, then step 10 and the reply.
  function handle(route: ContractRoute, controllers: ControllerLoader) {
    const entry = entryOf(route.id);

    return async (ctx: HttpContext): Promise<void> => {
      const context = requireContext(route);

      try {
        const controller = await controllers.instanceFor(ctx, route, entry);
        const method: unknown = Reflect.get(controller, entry.operation);

        if (typeof method !== "function") {
          throw unexpectedError(
            route,
            new Error(`seampact: the controller has no method '${entry.operation}'`),
          );
        }

        const result: unknown = await method.call(controller, context.input);
        const reply = await handlerReply(checkState(context), requireGrant(context), result);

        await writeContractReply(ctx.response.response, context, reply);
      } catch (error) {
        await answerStepError(ctx, context, error);
      }
    };
  }

  /** Adds the api's routes and runs the boot check (ADR 0019 "The boot check"). */
  function registerRoutes(
    router: Router,
    registration: RouteRegistration<Hooks, Controllers, Operation>,
  ): void {
    const problems = [
      ...hookBootProblems(api, registration.hooks),
      ...controllerProblems(registration.controllers),
      ...bodyValidationProblems(registration),
      ...bodyparserProblems(api),
    ];

    if (problems.length > 0) throw new Error(bootProblemsMessage(api, problems));

    registered.hooks = registration.hooks;

    const replyOptions = replyOptionsOf(registration);
    const controllers = controllerLoader(registration.controllers, entries);

    for (const route of orderedApi.routes) {
      router
        .route(adonisPath(route.path), adonisMethods(route), handle(route, controllers))
        .as(routeNameOf(route))
        .use([openContext(route, replyOptions), authorize(route), validate(route)]);
    }
  }

  interface ReplyOptionsOf {
    readonly hooks: BoundaryHooks;
    replyOptionsOf(route: ContractRoute): { responses: ResponsesMode; bodyValidation: boolean };
  }

  // Operation, then registration, then target option.
  function replyOptionsOf(
    registration: RouteRegistration<Hooks, Controllers, Operation>,
  ): ReplyOptionsOf {
    return {
      hooks: registration.hooks,
      replyOptionsOf(route) {
        const operation = operationOptions(registration, entryOf(route.id).operation);

        return {
          responses: operation?.responses ?? registration.responses ?? options.responses,
          bodyValidation:
            operation?.bodyValidation ?? registration.bodyValidation ?? options.bodyValidation,
        };
      },
    };
  }

  function operationOptions(
    registration: RouteRegistration<Hooks, Controllers, Operation>,
    operation: string,
  ): OperationReplyOptions | undefined {
    const overrides: unknown = registration.operations;

    if (!isPlainObject(overrides) || !Object.hasOwn(overrides, operation)) return undefined;

    const value: unknown = overrides[operation];

    return isPlainObject(value) ? value : undefined;
  }

  // One problem per operation of an interface without a controller, so each names its operation.
  function controllerProblems(controllers: Controllers): BootProblem[] {
    return entries
      .filter((entry) => typeof Reflect.get(controllers, entry.endpoints) !== "function")
      .map(({ id, endpoints: name }) => ({
        operation: id,
        problem: `no controller for the interface '${name}'`,
        fix: `add 'controllers.${name}: () => import(...)' with a controller that implements ${name}`,
      }));
  }

  // The item validators exist only when the target was generated with `bodyValidation: true`.
  function bodyValidationProblems(
    registration: RouteRegistration<Hooks, Controllers, Operation>,
  ): BootProblem[] {
    if (options.bodyValidation) return [];

    const replyOptions = replyOptionsOf(registration);

    return api.routes
      .filter((route) => replyOptions.replyOptionsOf(route).bodyValidation)
      .map((route) => ({
        operation: route.id,
        problem:
          "bodyValidation is on, but the target was generated without its response validators",
        fix: "set the target option 'bodyValidation: true' and generate again, or turn it off in the registration",
      }));
  }

  return {
    registerRoutes,
    renderPreRoutingError,
    renderContractError,
    operation: <Input>(id: string): OperationAccessor<Input> => ({
      input(ctx: HttpContext): Input {
        const stored = inputs.get(ctx);

        if (stored?.id !== id) {
          throw new Error(
            `seampact: no validated input of '${id}' on this request; read it inside the route of '${id}', after its middleware.`,
          );
        }

        // The value the operation's input validator produced, of the type the generated module names.
        return stored.input as Input;
      },
    }),
  };

  /** Writes a contract error in the api's format from an app's exception handler; false outside a contract route. */
  async function renderContractError(ctx: HttpContext, error: unknown): Promise<boolean> {
    const context = boundaryContext.getStore();

    if (context === undefined || context.api.id !== api.id) return false;

    await respondWithError(
      ctx.response.response,
      context,
      context.hooks,
      api,
      context.route,
      asContractError(context.route, error),
      requestLine(ctx),
    );

    return true;
  }

  /** Renders, on a contract path, a refusal raised before the boundary; false when it does nothing. */
  async function renderPreRoutingError(error: unknown, ctx: HttpContext): Promise<boolean> {
    if (boundaryContext.getStore() !== undefined) return false;

    const { method, path } = requestLine(ctx);

    if (!matchesContractPath(api, path)) return false;

    const route =
      matchContractRoute(orderedApi, method, path)?.route ??
      orderedApi.routes.find((candidate) =>
        matchesContractPath({ ...api, routes: [candidate] }, path),
      );

    await respondWithError(
      ctx.response.response,
      undefined,
      registered.hooks,
      api,
      route,
      preRoutingError(route, error),
      { method, path },
    );

    return true;
  }
}

interface ControllerLoader {
  instanceFor(ctx: HttpContext, route: ContractRoute, entry: AdonisOperationEntry): Promise<object>;
}

type ControllerClass = new (...dependencies: never[]) => unknown;

// Loads each controller once, at its first request, and checks it carries every method of its interface: a missing
// method answers 500 on every route of that controller (ADR 0019 "The boot check").
function controllerLoader(
  controllers: object,
  entries: readonly AdonisOperationEntry[],
): ControllerLoader {
  const loaded = new Map<string, Promise<LoadedController>>();

  return {
    async instanceFor(ctx, route, entry) {
      let controller = loaded.get(entry.endpoints);

      if (controller === undefined) {
        controller = loadController(controllers, entries, entry.endpoints);
        loaded.set(entry.endpoints, controller);
      }

      const { controllerClass, missingMethods } = await controller;

      if (missingMethods.length > 0) {
        throw unexpectedError(
          route,
          new Error(
            `seampact: the controller of '${entry.endpoints}' lacks ${missingMethods.join(", ")}`,
          ),
        );
      }

      const instance: unknown = await ctx.containerResolver.make(controllerClass);

      if (typeof instance !== "object" || instance === null) {
        throw unexpectedError(
          route,
          new Error(`seampact: the controller of '${entry.endpoints}' made no object`),
        );
      }

      return instance;
    },
  };
}

interface LoadedController {
  readonly controllerClass: ControllerClass;
  readonly missingMethods: readonly string[];
}

async function loadController(
  controllers: object,
  entries: readonly AdonisOperationEntry[],
  endpoints: string,
): Promise<LoadedController> {
  const importer: unknown = Reflect.get(controllers, endpoints);

  if (typeof importer !== "function") {
    throw new Error(`seampact: no controller import for '${endpoints}'`);
  }

  const module: unknown = await importer();
  const controller: unknown =
    typeof module === "object" && module !== null ? Reflect.get(module, "default") : undefined;

  if (!isControllerClass(controller)) {
    throw new Error(
      `seampact: the controller module of '${endpoints}' has no default export class; export the controller class as default.`,
    );
  }

  const missingMethods = entries
    .filter((entry) => entry.endpoints === endpoints)
    .map((entry) => entry.operation)
    .filter((method) => typeof Reflect.get(controller.prototype, method) !== "function");

  if (missingMethods.length > 0) {
    console.error(
      `seampact: the controller of '${endpoints}' lacks the methods ${missingMethods.join(", ")}; every route of it answers 500. Implement each method of ${endpoints}.`,
    );
  }

  return { controllerClass: controller, missingMethods };
}

function isControllerClass(value: unknown): value is ControllerClass {
  return typeof value === "function";
}

/** The route names of one api per access kind, for app middleware that skips public or optional routes. */
export function routeNamesByAccess(
  api: ContractApi,
  entries: readonly AdonisOperationEntry[],
): Readonly<Record<RouteAccessKind, readonly string[]>> {
  const names: Record<RouteAccessKind, string[]> = {
    public: [],
    optional: [],
    identity: [],
    signed: [],
  };

  for (const route of api.routes) {
    const entry = entries.find((candidate) => candidate.id === route.id);

    if (entry !== undefined) names[accessKindOf(route)].push(`${api.id}.${entry.operation}`);
  }

  return names;
}

/** Every bodyparser setting a contract route needs, read through the app's config (ADR 0019 "The boot check"). */
function bodyparserProblems(api: ContractApi): BootProblem[] {
  const bodyRoutes = api.routes.filter((route) => route.input !== undefined);

  if (bodyRoutes.length === 0) return [];

  // The app service is set once the app boots, before it preloads `start/routes.ts`.
  if (app === undefined) {
    return [
      {
        problem: "the AdonisJS app service is not set, so the bodyparser config cannot be read",
        fix: "call registerRoutes from start/routes.ts, which the app preloads once it boots, and import the generated module only after the app is created",
      },
    ];
  }

  const config: unknown = app.config.get(BODYPARSER_CONFIG_KEY, undefined);
  const json: unknown = isPlainObject(config) ? config.json : undefined;

  if (!isPlainObject(config) || !isPlainObject(json)) {
    return [
      {
        problem: "the app has no bodyparser config with a 'json' entry",
        fix: "add config/bodyparser.ts with defineConfig from @adonisjs/core/bodyparser",
      },
    ];
  }

  return [
    ...jsonLimitProblems(bodyRoutes, json.limit),
    ...jsonEncodingProblems(json.encoding),
    ...listedProblems(
      bodyRoutes,
      json.types,
      (route) => route.input?.media ?? "",
      "json.types",
      "media type",
    ),
    ...listedProblems(
      bodyRoutes,
      config.allowedMethods,
      (route) => route.method.toUpperCase(),
      "allowedMethods",
      "method",
    ),
  ];
}

function largestBodyLimit(routes: readonly ContractRoute[]): number {
  return Math.max(0, ...routes.map((route) => route.input?.limitBytes ?? 0));
}

function jsonLimitProblems(routes: readonly ContractRoute[], limit: unknown): BootProblem[] {
  const largest = largestBodyLimit(routes);
  const bytes =
    typeof limit === "number"
      ? limit
      : typeof limit === "string"
        ? string.bytes.parse(limit)
        : null;

  if (typeof bytes === "number" && bytes >= largest) return [];

  return [
    {
      problem: `the bodyparser's json.limit (${String(limit)}) is below the largest route limit, ${largest} bytes`,
      fix: "set json.limit in config/bodyparser.ts to at least the generated LARGEST_BODY_LIMIT",
    },
  ];
}

// The re-encoded bytes and the 413 count assume the bodyparser decoded the body as UTF-8.
function jsonEncodingProblems(encoding: unknown): BootProblem[] {
  if (
    encoding === undefined ||
    (typeof encoding === "string" && UTF8_ENCODINGS.includes(encoding.toLowerCase()))
  ) {
    return [];
  }

  return [
    {
      problem: `the bodyparser's json.encoding is '${String(encoding)}', not UTF-8`,
      fix: "set json.encoding in config/bodyparser.ts to 'utf-8'",
    },
  ];
}

function listedProblems(
  routes: readonly ContractRoute[],
  listed: unknown,
  requiredOf: (route: ContractRoute) => string,
  setting: string,
  what: string,
): BootProblem[] {
  const values = Array.isArray(listed) ? listed.filter((value) => typeof value === "string") : [];

  return routes
    .filter((route) => !values.includes(requiredOf(route)))
    .map((route) => ({
      operation: route.id,
      problem: `the ${what} '${requiredOf(route)}' is not in the bodyparser's ${setting}`,
      fix: `add '${requiredOf(route)}' to ${setting} in config/bodyparser.ts`,
    }));
}
