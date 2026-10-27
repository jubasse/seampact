// The NestJS placement of the shared request checks (ADR 0016): the module middleware, the per-operation composite
// and input decorators, the guard, the input pipe, the handler wrapper, the opt-in reply interceptor, the narrow
// filter, the dynamic module with its boot check (the framework-route check included), and the exported helpers.
// Each api's generated module calls `createNestBoundary` once with its route table and its identity: its own
// `ContractException` subclass and its module's class name.
import { type IncomingMessage, ServerResponse } from "node:http";
import {
  type ArgumentMetadata,
  type ArgumentsHost,
  applyDecorators,
  type CallHandler,
  type CanActivate,
  Catch,
  createParamDecorator,
  Delete,
  type DynamicModule,
  type ExceptionFilter,
  type ExecutionContext,
  ForbiddenException,
  Get,
  HttpException,
  Inject,
  Injectable,
  type InjectionToken,
  type MiddlewareConsumer,
  Module,
  type ModuleMetadata,
  type NestInterceptor,
  type NestModule,
  NotFoundException,
  type OnApplicationBootstrap,
  type OptionalFactoryDependency,
  Patch,
  type PipeTransform,
  Post,
  type Provider,
  Put,
  RequestMethod,
  Res,
  SetMetadata,
  type Type,
  UnauthorizedException,
  UseFilters,
  UseGuards,
  VERSION_NEUTRAL,
  Version,
} from "@nestjs/common";
import {
  type AbstractHttpAdapter,
  APP_INTERCEPTOR,
  ApplicationConfig,
  BaseExceptionFilter,
  DiscoveryModule,
  DiscoveryService,
  HttpAdapterHost,
  ModulesContainer,
  Reflector,
} from "@nestjs/core";
import { ExecutionContextHost } from "@nestjs/core/internal";
import { mergeMap, type Observable, takeLast } from "rxjs";
import { type AccessGrant, authorizeRequest, type CheckState } from "./access-checks.js";
import {
  basePathClaimsOf,
  claimsBasePathAlone,
  registerBasePathClaim,
} from "./base-path-claims.js";
import { type BoundaryContext, boundaryContext } from "./boundary-context.js";
import {
  type BootProblem,
  type BoundaryHooks,
  bootProblemsMessage,
  enforcedHookBootProblems,
  type RegisteredHooks,
  resolvedHooks,
} from "./boundary-hooks.js";
import { ContractError, renderContractReply, unexpectedError } from "./contract-error.js";
import {
  type ContractApi,
  type ContractRoute,
  isUnderBasePath,
  isUnderPrefix,
  largestRouteBodyLimit,
  matchContractPath,
  matchContractRoute,
  matchesContractPath,
  type ResponsesMode,
} from "./contract-route.js";
import {
  declaresStatus,
  logWriteFailure,
  notFoundError,
  refusalFacts,
  type StatusErrorFixes,
  statusError,
} from "./error-reply.js";
import { routeKey } from "./framework-route-patterns.js";
import { frameworkRouteProblems } from "./framework-routes.js";
import { refuseCodeOfOtherVersion } from "./generator-version-check.js";
import { type HandlerAccess, handlerAccess, inputWithAccess } from "./handler-access.js";
import { handlerReply } from "./handler-reply.js";
import { beginIdempotency } from "./idempotency.js";
import { checkRestrictedInput, validateRequestInput } from "./input-checks.js";
import { everyRouteHandler, expressRouteListing, routeEntries } from "./node-express-routes.js";
import { installOutgoingCheck } from "./node-outgoing-check.js";
import {
  respondNotServed,
  respondWithError,
  responseHeaderValues,
  writeContractReply,
} from "./node-reply.js";
import {
  bodyParserError,
  clearEmptyBody,
  contractRequest,
  DEFAULT_METHOD,
  type ExpressRequest,
  expressBodyGlue,
  parserErrorStatus,
  pathnameOf,
  reportedRequest,
} from "./node-request.js";
import { isPlainObject } from "./plain-object.js";
import { RETRY_AFTER_HEADER } from "./retry-after.js";
import {
  loggerProblems,
  type RuntimeLogger,
  runtimeLogOf,
  useRuntimeLogger,
} from "./runtime-logger.js";
import { type PlatformFixes, transportRefusal } from "./transport-checks.js";

/** Who writes a contract route's reply after step 10: the handler wrapper, or the seampact reply interceptor. */
export type ReplyMode = "handler" | "interceptor";

export interface NestBoundaryOptions {
  readonly responses: ResponsesMode;
  readonly bodyValidation: boolean;
  readonly reply: ReplyMode;
}

/** What tells one api's boundary from another's in an app that serves several (ADR 0025). */
export interface NestApiIdentity {
  /** The api's own `ContractException` subclass: its filter answers it, never another api's. */
  readonly contractException: new (
    ...args: never
  ) => ContractError;
  /** The class name of the api's module, carrying the api's type name, as NestJS logs it. */
  readonly moduleClassName: string;
}

/** The options of `SeampactModule.forRoot(hooks, options)`. */
export interface SeampactModuleOptions {
  /** Where the boundary writes its warnings and unexpected failures; the console when absent. */
  readonly logger?: RuntimeLogger;
  /**
   * What the boot check does with a contract operation no controller method binds: `error` (the default) stops the
   * boot, `warn` logs them once, for a test module that holds some controllers only; their routes answer the api's 404.
   */
  readonly unboundOperations?: UnboundOperations;
}

/** The value of the `unboundOperations` option of `SeampactModule.forRoot`. */
export type UnboundOperations = "error" | "warn";

/** What `configureApp` calls on a NestJS Express app, as `NestExpressApplication` declares it. */
export interface ConfigurableNestApp {
  useBodyParser(
    parser: "json",
    options: {
      limit?: number;
      strict: boolean;
      verify: (request: IncomingMessage, response: ServerResponse, bytes: Buffer) => void;
    },
  ): unknown;
  useGlobalFilters(...filters: ExceptionFilter[]): unknown;
}

/** The arguments of `SeampactModule.forRootAsync`, in the shape of NestJS's `ConfigurableModuleBuilder`. */
export interface SeampactModuleAsyncHooks<Hooks> {
  /** The modules that export the providers `inject` names. */
  readonly imports?: ModuleMetadata["imports"];
  /** The providers passed to `useFactory`, in order. */
  readonly inject?: readonly (InjectionToken | OptionalFactoryDependency)[];
  /** Builds the api's hooks from the injected providers. */
  readonly useFactory: (...providers: never[]) => Hooks | Promise<Hooks>;
}

/** A declared error of the api: its code, and its params when the code declares them. */
export interface DeclaredContractError {
  readonly code: string;
  readonly params?: unknown;
}

/** The errors a handler method returns, from its generated signature. */
export type ErrorsOf<Method> = Method extends (...input: never[]) => infer Result
  ? Extract<Awaited<Result>, { readonly code: string }>
  : never;

// One declared error's constructor arguments: its code, then its params when it declares them.
type ContractExceptionArguments<Errors> = Errors extends {
  readonly code: infer Code extends string;
}
  ? Errors extends { readonly params: infer Params }
    ? [code: Code, params: Params]
    : Errors extends { readonly params?: infer Params }
      ? "params" extends keyof Errors
        ? [code: Code, params?: Params]
        : [code: Code]
      : [code: Code]
  : never;

/**
 * A declared error a handler or a service throws; the operation's filter answers its code in the api's format, and a
 * code the operation does not declare is its 500. The generated module types it with the api's codes and params.
 */
export class ContractException<
  Errors extends DeclaredContractError = DeclaredContractError,
> extends ContractError {
  constructor(...[code, params]: ContractExceptionArguments<Errors>) {
    super(code, params);
    this.name = "ContractException";
  }
}

/** The api's dynamic module class, as the generated module exports it. */
export interface SeampactModuleClass<Hooks> {
  new (): object;
  forRoot(...[hooks, moduleOptions]: ModuleArguments<Hooks>): DynamicModule;
  /** The module with hooks a factory builds from injected providers. */
  forRootAsync(
    asyncHooks: SeampactModuleAsyncHooks<Hooks>,
    moduleOptions?: SeampactModuleOptions,
  ): DynamicModule;
}

type ModuleArguments<Hooks> =
  Partial<Hooks> extends Hooks
    ? [hooks?: Hooks, options?: SeampactModuleOptions]
    : [hooks: Hooks, options?: SeampactModuleOptions];

// A route `setGlobalPrefix`'s `exclude` option keeps unprefixed, as `ApplicationConfig` holds it.
type ExcludedRoute = NonNullable<
  ReturnType<ApplicationConfig["getGlobalPrefixOptions"]>["exclude"]
>[number];

type ContractMethod = (this: unknown, ...args: unknown[]) => unknown;

interface OperationMetadata {
  readonly api: string;
  readonly id: string;
  readonly access: string;
}

interface DiscoveredContractMethod {
  readonly prototype: object;
  readonly name: string;
  readonly method: object;
  readonly metadata: OperationMetadata;
  /** The class of the module that declares the controller, where `RouterModule` records its path. */
  readonly module: unknown;
  /** The interceptors the module of the controller instantiated, by the class a decorator bound. */
  readonly injectables: ReadonlyMap<
    unknown,
    { readonly instance: unknown; isDependencyTreeStatic(): boolean }
  >;
}

// NestJS's own metadata keys and route param types, read through `Reflector` (public decorators write them).
const ROUTE_ARGS_METADATA = "__routeArguments__";
const GUARDS_METADATA = "__guards__";
const INTERCEPTORS_METADATA = "__interceptors__";
const REDIRECT_METADATA = "__redirect__";
const HTTP_CODE_METADATA = "__httpCode__";
const HEADERS_METADATA = "__headers__";
const PATH_METADATA = "path";
const MODULE_PATH_METADATA = "__module_path__";
const RENDER_METADATA = "__renderTemplate__";
const SSE_METADATA = "__sse__";
const RESPONSE_PARAM_TYPE = 1;
const NEXT_PARAM_TYPE = 2;
const OPERATION_METADATA = "seampact:operation";
const RESPONSE_INDEX_METADATA = "seampact:responseIndex";
const INTERCEPTOR_REPLY: ReplyMode = "interceptor";
const LOGGER_OPTION = "logger";
const NO_BODY_LIMIT = 0;
const UNBOUND_OPERATIONS_OPTION = "unboundOperations";
const MODULE_OPTION_NAMES: readonly string[] = [LOGGER_OPTION, UNBOUND_OPERATIONS_OPTION];
const UNBOUND_OPERATIONS_VALUES: readonly unknown[] = [
  "error",
  "warn",
] satisfies UnboundOperations[];
const WARN_UNBOUND: UnboundOperations = "warn";
// Marks every api's reply interceptor, so an api's boot check never names another api's as an app interceptor.
const REPLY_INTERCEPTOR_MARK = Symbol.for("seampact.nestjs.reply-interceptor");
const EXPRESS_PLATFORM = "express";
const NOT_FOUND = 404;
const TOO_MANY_REQUESTS = 429;
const INTERNAL_STATUS = 500;
const ROOT_PATHS: readonly unknown[] = [undefined, "", "/"];
// A thrown code goes into a logged message: longer codes are cut, so an app's input never floods the log.
const MAX_LOGGED_CODE_LENGTH = 100;
const NEST_STATUS_FIXES: StatusErrorFixes = {
  requiredParams: "throw ContractException(code, params) with its params",
  severalCodes: "throw a ContractException of the one it means",
};
const NEST_FIXES: PlatformFixes = {
  rawBody:
    "NestJS keeps it as a Buffer on req.rawBody: create the app with { rawBody: true }, or pass the generated keepRawBody as the JSON parser's verify function with rawBody off.",
  bodySize:
    "Create the app with { rawBody: true }, or pass the generated keepRawBody as the JSON parser's verify function.",
};

const ROUTE_DECORATORS = { get: Get, post: Post, put: Put, patch: Patch, delete: Delete } as const;
const REQUEST_METHODS = {
  get: RequestMethod.GET,
  post: RequestMethod.POST,
  put: RequestMethod.PUT,
  patch: RequestMethod.PATCH,
  delete: RequestMethod.DELETE,
} as const;

/** A 429 `HttpException`, such as `@nestjs/throttler`'s, matched without importing the throttler. */
// biome-ignore lint/complexity/noStaticOnlyClass: `@Catch()` matches exceptions with `instanceof`, which this class answers.
class TooManyRequestsRefusal {
  static [Symbol.hasInstance](value: unknown): boolean {
    return value instanceof HttpException && value.getStatus() === TOO_MANY_REQUESTS;
  }
}

// NestJS copies a controller method's metadata to the handler it registers on Express, so an operation's handler
// carries the operation's metadata, whichever api of the app declares it.
function isOperationHandler(handler: unknown): boolean {
  return (
    typeof handler === "function" && Reflect.getMetadata(OPERATION_METADATA, handler) !== undefined
  );
}

// NestJS binds a middleware applied to a route as an Express route of its own, in a wrapper that keeps no trace of
// the middleware. Every api records the routes it applies its middleware to, by adapter, in one registry for every
// api's copy of this module; the check takes one Express route per record as the boundary's, so a second route at
// a contract path is still listed.
const MIDDLEWARE_ROUTES_KEY = Symbol.for("seampact.nestjs.middleware-routes");

function middlewareRouteRegistry(): WeakMap<WeakKey, string[]> {
  const existing: unknown = Reflect.get(globalThis, MIDDLEWARE_ROUTES_KEY);

  if (existing instanceof WeakMap) return existing;

  const created = new WeakMap<WeakKey, string[]>();

  Reflect.set(globalThis, MIDDLEWARE_ROUTES_KEY, created);

  return created;
}

function recordMiddlewareRoutes(adapter: object, routes: readonly ContractRoute[]): void {
  const registry = middlewareRouteRegistry();
  const keys = routes.map((route) => routeKey(methodOf(route).toUpperCase(), nestPath(route.path)));

  registry.set(adapter, [...(registry.get(adapter) ?? []), ...keys]);
}

function middlewareRoutesOf(adapter: object): readonly string[] {
  return middlewareRouteRegistry().get(adapter) ?? [];
}

// An operation's route, or one route per recorded middleware binding with its method and path; fresh per check.
function boundaryRouteFilter(middlewareRoutes: readonly string[]): (route: object) => boolean {
  const unclaimed = [...middlewareRoutes];

  return (route) => {
    if (everyRouteHandler(route, isOperationHandler)) return true;

    const [entry, ...others] = routeEntries(route);

    if (entry === undefined || others.length > 0) return false;

    const index = unclaimed.indexOf(routeKey(entry.method, entry.path));

    if (index === -1) return false;

    unclaimed.splice(index, 1);

    return true;
  };
}

/** An `HttpException` thrown on a contract route whose status the route declares, by role or by status. */
// biome-ignore lint/complexity/noStaticOnlyClass: `@Catch()` matches exceptions with `instanceof`, which this class answers.
class DeclaredStatusException {
  static [Symbol.hasInstance](value: unknown): boolean {
    const route = boundaryContext.getStore()?.route;

    if (!(value instanceof HttpException) || route === undefined) return false;

    return declaresStatus(route, value.getStatus());
  }
}

function isFrameworkDenial(error: unknown): boolean {
  return error instanceof UnauthorizedException || error instanceof ForbiddenException;
}

function checkState(context: BoundaryContext, request: ExpressRequest): CheckState {
  return {
    api: context.api,
    route: context.route,
    request: contractRequest(request),
    pathParams: context.pathParams,
    hooks: context.hooks,
    isFrameworkDenial,
    fixes: NEST_FIXES,
  };
}

function requireContext(): BoundaryContext {
  const context = boundaryContext.getStore();

  if (context === undefined) {
    throw unexpectedError(
      undefined,
      new Error(
        "seampact: a contract route ran without its request context; import the api's SeampactModule.forRoot(...) in the app module, and serve the contract routes without a path prefix.",
      ),
    );
  }

  return context;
}

/** The NestJS boundary of one api. */
export function createNestBoundary<Hooks extends RegisteredHooks>(
  api: ContractApi,
  options: NestBoundaryOptions,
  identity: NestApiIdentity,
) {
  refuseCodeOfOtherVersion(api);

  // The app's hooks, exported for `overrideProvider`, and the boundary's resolved copy of them.
  const SEAMPACT_HOOKS = Symbol(`seampact:${api.id}:hooks`);
  const HOOKS = Symbol(`seampact:${api.id}:resolved-hooks`);
  const MODULE_OPTIONS = Symbol(`seampact:${api.id}:options`);
  const RESPONSES_METADATA = `seampact:${api.id}:responses`;
  const bodyGlue = expressBodyGlue(api);
  const reflector = new Reflector();
  // Set when the module starts: what the exported pre-routing filter and helper reach outside a request context.
  const platform: { adapterHost?: HttpAdapterHost; hooks?: BoundaryHooks } = {};
  // The HTTP adapters of the apps the module was bootstrapped in.
  const bootstrappedAdapters = new WeakSet<object>();
  // The operations each app's module left unbound under `unboundOperations: 'warn'`, keyed by its Express app.
  const unboundRouteIdsOfApp = new WeakMap<object, ReadonlySet<string>>();

  const routeOf = (id: string): ContractRoute => {
    const route = api.routes.find((candidate) => candidate.id === id);

    if (route === undefined)
      throw new Error(`seampact: the api '${api.id}' has no operation '${id}'.`);

    return route;
  };

  const middleware =
    (hooks: BoundaryHooks) =>
    (request: ExpressRequest, response: ServerResponse, next: () => void): void => {
      const { method, path } = reportedRequest(request);
      const matched = matchContractRoute(api, method, path);

      // A path outside the api's base paths that Express still routed here (`/V1/...` on `/v1`) is the app's 404.
      if (matched === undefined && !isUnderBasePath(api, path) && !isUnderPrefix(api, path)) {
        throw new NotFoundException(`Cannot ${method} ${path}`);
      }

      if (matched === undefined) {
        void respondUnmatched(response, hooks, { method, path });

        return;
      }

      if (isUnboundInApp(request, matched.route)) {
        void respondNotServed(response, hooks, api, { method, path });

        return;
      }

      const context: BoundaryContext = {
        api,
        route: matched.route,
        pathParams: matched.pathParams,
        hooks,
        bodyValidation: options.bodyValidation,
        mode: options.responses,
        boundaryWriting: false,
      };
      const recorded = bodyGlue.recordedBodyBytes(request);

      clearEmptyBody(request, recorded);
      installOutgoingCheck(response, context, { method, path });
      boundaryContext.run(context, () => {
        const refusal = transportRefusal(matched.route, contractRequest(request), {
          ...(recorded === undefined ? {} : { recordedBytes: recorded }),
          fixes: NEST_FIXES,
        });

        if (refusal === undefined) {
          next();

          return;
        }

        void respondWithError(response, context, hooks, api, context.route, refusal, {
          method,
          path,
        });
      });
    };

  function isUnboundInApp(request: ExpressRequest, route: ContractRoute): boolean {
    const app = expressAppKey(Reflect.get(request, "app"));

    return app !== undefined && unboundRouteIdsOfApp.get(app)?.has(route.id) === true;
  }

  // Express routes a path case-insensitively and with or without a trailing slash; the contract serves the path as
  // written, so such a path under the base path answers the api's 404. Only a path under a prefix is a setup error.
  async function respondUnmatched(
    response: ServerResponse,
    hooks: BoundaryHooks,
    request: { readonly method: string; readonly path: string },
  ): Promise<void> {
    if (isUnderPrefix(api, request.path)) {
      runtimeLogOf(api).error(
        `seampact: ${request.method} ${request.path} reached a contract route under another path; a global prefix differs from the entry's mount (write the prefix as the entry's 'mount' in seampact.config.yaml instead). Exclude the contract routes with setGlobalPrefix's 'exclude' option.`,
      );
      await writeContractReply(
        response,
        api,
        undefined,
        renderContractReply(api, undefined, unexpectedError(undefined, undefined)),
      );

      return;
    }

    await respondNotServed(response, hooks, api, request);
  }

  // Steps 2 to 5: the access checks, after every app guard of the route (`moveContractGuardLast`).
  @Injectable()
  class ContractGuard implements CanActivate {
    async canActivate(execution: ExecutionContext): Promise<boolean> {
      const context = requireContext();
      const operation = reflector.get<OperationMetadata | undefined>(
        OPERATION_METADATA,
        execution.getHandler(),
      );

      // NestJS routed the request to another operation of this api than the raw path names: the path's 404, so no
      // handler runs under another operation's checks.
      if (operation?.api === api.id && operation.id !== context.route.id) {
        throw notFoundError(context.route);
      }

      if (operation?.id !== context.route.id) {
        throw unexpectedError(
          context.route,
          new Error(
            `seampact: the handler of '${operation?.id ?? "(none)"}' serves the route of '${context.route.id}'.`,
          ),
        );
      }

      context.mode =
        reflector.getAllAndOverride<ResponsesMode | undefined>(RESPONSES_METADATA, [
          execution.getHandler(),
          execution.getClass(),
        ]) ?? context.mode;
      const request: ExpressRequest = execution.switchToHttp().getRequest();
      const state = checkState(context, request);

      context.checkState = state;
      context.grant = await authorizeRequest(state);

      return true;
    }
  }

  // Steps 6 to 8 on the operation's input param. NestJS runs a param's own pipes after the global, controller and
  // route pipes, so the value an app pipe returns is ignored and the handler receives exactly this pipe's output.
  @Injectable()
  class ContractInputPipe implements PipeTransform {
    async transform(): Promise<unknown> {
      const context = requireContext();
      const { state, grant } = guardedRequest(context);
      const validated = await validateRequestInput(state, grant);
      const input = await checkRestrictedInput(state, grant, validated);

      context.input = input;
      context.inputChecked = true;

      return inputWithAccess(context.route, grant, input);
    }
  }

  const contractInputPipe = new ContractInputPipe();

  // What the guard recorded; a route that skipped it fails closed.
  function guardedRequest(context: BoundaryContext): { state: CheckState; grant: AccessGrant } {
    const { checkState: state, grant } = context;

    if (context.api.id !== api.id || state === undefined || grant === undefined) {
      throw unexpectedError(
        context.route,
        new Error(`seampact: the guard of '${context.route.id}' did not run.`),
      );
    }

    return { state, grant };
  }

  // The method and step 10 never run on an input steps 6 to 8 did not check.
  function requireCheckedInput(context: BoundaryContext): void {
    if (context.inputChecked === true) return;

    throw unexpectedError(
      context.route,
      new Error(
        `seampact: '${context.route.id}' reached its handler without the input pipe; declare its @${context.route.id}.input() parameter, and skip contract routes with isContractRoute(context) in an interceptor that answers without next.handle().`,
      ),
    );
  }

  // Replaces the controller method in place (`applyDecorators` ignores a returned descriptor): on its own operation's
  // request it runs the idempotency claim or replay and the method, then, in the default reply mode, step 10 and the
  // write, and returns no value, so NestJS needs no interceptor on the route. Anywhere else it is the method itself.
  const contractHandler =
    (id: string): MethodDecorator =>
    (_target, _key, descriptor) => {
      const method: unknown = descriptor.value;

      if (typeof method !== "function") {
        throw new Error(`seampact: @${id}() decorates a method only.`);
      }

      const wrapped: ContractMethod = function (this: unknown, ...args: unknown[]): unknown {
        const context = boundaryContext.getStore();

        if (context?.api.id !== api.id || context.route.id !== id || context.handlerStarted) {
          return method.apply(this, args);
        }

        context.handlerStarted = true;

        return serveContractRequest(context, wrapped, args, () => method.apply(this, args));
      };

      copyMethodIdentity(method, wrapped);
      Reflect.set(descriptor, "value", wrapped);
    };

  // In the interceptor mode the result goes back up NestJS's interceptors, and the reply interceptor writes it.
  async function serveContractRequest(
    context: BoundaryContext,
    wrapped: object,
    args: readonly unknown[],
    callMethod: () => unknown,
  ): Promise<unknown> {
    const response = handledResponse(context, wrapped, args);
    const { state, grant } = guardedRequest(context);

    requireCheckedInput(context);

    const started = await beginIdempotency(state, grant, context.input);

    if (started?.outcome === "replay") {
      await writeContractReply(response, api, context, started.reply);
      context.replyWritten = true;

      return undefined;
    }

    if (started?.outcome === "started") context.idempotencyKey = started.key;

    const result: unknown = await methodResult(context, callMethod);

    if (options.reply === INTERCEPTOR_REPLY) return result;

    await writeHandlerReply(context, response, result);

    return undefined;
  }

  // An exception of the method is kept, so the outgoing check reports it, or leaves it to NestJS under debug, when
  // no seampact filter claims it, with or without the pre-routing filter.
  async function methodResult(
    context: BoundaryContext,
    callMethod: () => unknown,
  ): Promise<unknown> {
    try {
      return await callMethod();
    } catch (exception) {
      context.unclaimedException = exception;

      throw exception;
    }
  }

  // Step 10 on the handler's result, or on the value the app's interceptors mapped it to, then the write.
  async function writeHandlerReply(
    context: BoundaryContext,
    response: ServerResponse,
    result: unknown,
  ): Promise<void> {
    const { state, grant } = guardedRequest(context);
    const reply = await handlerReply(state, grant, context.input, result);

    await writeContractReply(response, api, context, reply);
    context.replyWritten = true;
  }

  // Step 10 and the write in the interceptor mode, outermost among the app's interceptors (an `APP_INTERCEPTOR`),
  // so every global, controller and route mapping is the value checked. The response stays marked as handled, so
  // NestJS writes nothing after it.
  @Injectable()
  class ContractReplyInterceptor implements NestInterceptor {
    readonly [REPLY_INTERCEPTOR_MARK] = true;

    intercept(execution: ExecutionContext, next: CallHandler): Observable<unknown> {
      const context = boundaryContext.getStore();

      if (context?.api.id !== api.id || !isContractRoute(execution)) return next.handle();

      const response: ServerResponse = execution.switchToHttp().getResponse();

      // NestJS replies with the last value a stream emits; the boundary checks and writes that one only.
      return next.handle().pipe(
        takeLast(1),
        mergeMap((value: unknown) => replyFromInterceptor(context, response, value)),
      );
    }
  }

  async function replyFromInterceptor(
    context: BoundaryContext,
    response: ServerResponse,
    value: unknown,
  ): Promise<undefined> {
    if (context.replyWritten === true) return undefined;

    if (context.inputChecked !== true) {
      runtimeLogOf(api).error(
        `seampact: an app interceptor answered '${context.route.id}' without calling next.handle(); skip contract routes with isContractRoute(context).`,
      );
    }

    requireCheckedInput(context);
    await writeHandlerReply(context, response, value);

    return undefined;
  }

  const replyInterceptor = new ContractReplyInterceptor();

  // The response NestJS passes at the index the composite marked with `Res()`.
  function handledResponse(
    context: BoundaryContext,
    wrapped: object,
    args: readonly unknown[],
  ): ServerResponse {
    const index: unknown = Reflect.getMetadata(RESPONSE_INDEX_METADATA, wrapped);
    const response = typeof index === "number" ? args[index] : undefined;

    if (response instanceof ServerResponse) return response;

    throw unexpectedError(
      context.route,
      new Error(
        `seampact: the handler of '${context.route.id}' received no response at its marked parameter.`,
      ),
    );
  }

  // The controller methods NestJS registers for this api's operations: the composite's wrapper, or the function a
  // decorator above the composite put in its place with the composite's metadata copied (a tracing `@Span()`).
  function discoveredContractMethods(discovery: DiscoveryService): DiscoveredContractMethod[] {
    const discovered: DiscoveredContractMethod[] = [];

    for (const wrapper of discovery.getControllers()) {
      const instance: unknown = wrapper.instance;
      const injectables = wrapper.host?.injectables ?? new Map();
      const module: unknown = wrapper.host?.metatype;

      if (!isPlainObject(instance) && typeof instance !== "object") continue;

      const prototype: unknown = Object.getPrototypeOf(instance);

      if (prototype === null || typeof prototype !== "object") continue;

      for (const name of Object.getOwnPropertyNames(prototype)) {
        const method: unknown = Reflect.get(prototype, name);

        if (typeof method !== "function") continue;

        const metadata = reflector.get<OperationMetadata | undefined>(OPERATION_METADATA, method);

        if (metadata?.api === api.id) {
          discovered.push({ prototype, name, method, metadata, module, injectables });
        }
      }
    }

    return discovered;
  }

  // NestJS appends route guards in decorator order, bottom-up, so an app guard written above the composite comes
  // after the seampact guard; every app guard of the route runs first once it is moved last. NestJS reads the guards
  // of the function it registers when it registers the routes, after every module's `configure`.
  function moveContractGuardLast(methods: readonly DiscoveredContractMethod[]): void {
    for (const { method } of methods) {
      const appGuards = metadataList(GUARDS_METADATA, method).filter(
        (guard) => guard !== ContractGuard,
      );

      Reflect.defineMetadata(GUARDS_METADATA, [...appGuards, ContractGuard], method);
    }
  }

  // In the default reply mode the wrapper writes the reply before NestJS's interceptors see the result, so an app
  // interceptor observes that reply and the value it maps is dropped: said once for the app's global interceptors and
  // once per route for its controller and route ones. In the interceptor mode only a global one placed before the
  // reply interceptor after `moveReplyInterceptorFirst` sees the written reply.
  function warnIgnoredInterceptorMappings(
    methods: readonly DiscoveredContractMethod[],
    config: ApplicationConfig,
  ): void {
    if (options.reply === INTERCEPTOR_REPLY) {
      warnInterceptorsOutsideReply(config);

      return;
    }

    const globalInterceptors = [
      ...appInterceptors(config.getGlobalInterceptors()).map(interceptorName),
      ...config.getGlobalRequestInterceptors().map((wrapper) => String(wrapper.name)),
    ];

    if (globalInterceptors.length > 0) {
      runtimeLogOf(api).warn(
        `seampact: the app's global interceptors ${globalInterceptors.join(", ")} run on every contract route of the api '${api.id}'; they observe the reply seampact wrote and a value they map is ignored. Shape the reply in the handler, or generate the api with the target option reply: interceptor.`,
      );
    }

    for (const { prototype, method, metadata } of methods) {
      const interceptors = appInterceptors([
        ...metadataList(INTERCEPTORS_METADATA, prototype.constructor),
        ...metadataList(INTERCEPTORS_METADATA, method),
      ]);

      if (interceptors.length === 0) continue;

      const route = routeOf(metadata.id);

      runtimeLogOf(api).warn(
        `seampact: the route ${methodOf(route).toUpperCase()} ${route.path} of '${metadata.id}' carries the app interceptors ${interceptors.map(interceptorName).join(", ")}; they observe the reply seampact wrote and a value they map is ignored. Shape the reply in the handler instead.`,
      );
    }
  }

  // NestJS adds `APP_INTERCEPTOR` providers in module scanning order, the app module's before an imported one's, so
  // the reply interceptor is moved to the front of the global list in place: `ApplicationConfig` has no setter. NestJS
  // reads that list when it registers the routes, after every module's `configure`.
  function moveReplyInterceptorFirst(config: ApplicationConfig): void {
    if (options.reply !== INTERCEPTOR_REPLY) return;

    const globalInterceptors = config.getGlobalInterceptors();
    const index = globalInterceptors.indexOf(replyInterceptor);

    if (index <= 0) return;

    globalInterceptors.splice(index, 1);
    globalInterceptors.unshift(replyInterceptor);
  }

  // In the default reply mode, an app interceptor that answers without `next.handle()` would leave the route with no
  // reply, since the response is marked as handled. The reply interceptor then sits outside the app's interceptors of
  // each such route and answers 500 with a log: in front of the globals when the app has one, else first on the
  // controller or the method that binds one. Routes without an app interceptor stay off NestJS's interceptor path.
  function placeReplyCheck(
    methods: readonly DiscoveredContractMethod[],
    config: ApplicationConfig,
  ): void {
    if (options.reply === INTERCEPTOR_REPLY) return;

    const globalInterceptors = config.getGlobalInterceptors();
    const hasGlobalInterceptors =
      appInterceptors(globalInterceptors).length > 0 ||
      config.getGlobalRequestInterceptors().length > 0;

    if (hasGlobalInterceptors) {
      if (!globalInterceptors.includes(replyInterceptor))
        globalInterceptors.unshift(replyInterceptor);

      return;
    }

    for (const { prototype, method } of methods) {
      const controller: object = prototype.constructor;
      const target =
        metadataList(INTERCEPTORS_METADATA, controller).length > 0 ? controller : method;
      const interceptors = metadataList(INTERCEPTORS_METADATA, target);

      if (interceptors.length === 0 || interceptors.includes(replyInterceptor)) continue;

      Reflect.defineMetadata(INTERCEPTORS_METADATA, [replyInterceptor, ...interceptors], target);
    }
  }

  // A global an app module's `configure` placed in front after seampact's own still runs outside the reply.
  function warnInterceptorsOutsideReply(config: ApplicationConfig): void {
    const globalInterceptors = config.getGlobalInterceptors();
    const before = appInterceptors(
      globalInterceptors.slice(0, Math.max(globalInterceptors.indexOf(replyInterceptor), 0)),
    );

    if (before.length === 0) return;

    runtimeLogOf(api).warn(
      `seampact: the app's global interceptors ${before.map(interceptorName).join(", ")} run outside the reply interceptor of the api '${api.id}'; on its contract routes they observe the reply seampact wrote and a value they map is ignored. Register them with app.useGlobalInterceptors(...), which places them inside it.`,
    );
  }

  // A request-scoped interceptor has no instance at boot, so the cache probe cannot ask it for a key.
  function warnUnprobedRequestScopedInterceptors(
    methods: readonly DiscoveredContractMethod[],
    config: ApplicationConfig,
  ): void {
    const names = new Set<string>(
      config.getGlobalRequestInterceptors().map((wrapper) => String(wrapper.name)),
    );

    for (const discovered of methods) {
      for (const target of [discovered.prototype.constructor, discovered.method]) {
        for (const binding of metadataList(INTERCEPTORS_METADATA, target)) {
          if (isRequestScopedBinding(discovered, binding)) {
            names.add(interceptorName(binding));
          }
        }
      }
    }

    if (names.size === 0) return;

    runtimeLogOf(api).warn(
      `seampact: the request-scoped interceptors ${[...names].join(", ")} on the api '${api.id}' cannot be checked at boot; one that answers from a cache would skip the contract's input checks and reply for its callers.`,
    );
  }

  function isRequestScopedBinding(discovered: DiscoveredContractMethod, binding: unknown): boolean {
    if (typeof binding !== "function") return false;

    return discovered.injectables.get(binding)?.isDependencyTreeStatic() !== true;
  }

  // An interceptor that answers from a cache never calls the handler, so steps 6 to 8, the idempotency claim and
  // step 10 would not run for this caller. Probed through `trackBy` (`@nestjs/cache-manager`'s API, duck-typed) with
  // a request of the route's method and path: a key means a hit can answer the route.
  function cacheProblems(
    methods: readonly DiscoveredContractMethod[],
    config: ApplicationConfig,
  ): BootProblem[] {
    const problems: BootProblem[] = [];

    for (const discovered of methods) {
      const interceptors = [
        ...config.getGlobalInterceptors(),
        ...boundInterceptors(discovered, discovered.prototype.constructor),
        ...boundInterceptors(discovered, discovered.method),
      ];

      for (const interceptor of interceptors) {
        const problem = cacheProbeProblem(discovered, interceptor);

        if (problem !== undefined) problems.push(problem);
      }
    }

    return problems;
  }

  function cacheProbeProblem(
    { prototype, method, metadata }: DiscoveredContractMethod,
    interceptor: unknown,
  ): BootProblem | undefined {
    const trackBy: unknown =
      typeof interceptor === "object" && interceptor !== null
        ? Reflect.get(interceptor, "trackBy")
        : undefined;
    const controller: unknown = prototype.constructor;

    if (typeof trackBy !== "function" || typeof method !== "function") return undefined;

    if (!isConstructor(controller)) return undefined;

    const route = routeOf(metadata.id);
    const routeName = `${methodOf(route).toUpperCase()} ${route.path}`;
    const fix = `return undefined from ${interceptorName(interceptor)}'s trackBy when isContractRoute(context) is true, or remove it from the route`;
    const execution = new ExecutionContextHost(
      [probeRequest(route), {}, undefined],
      controller,
      method,
    );

    execution.setType("http");

    try {
      const key: unknown = Reflect.apply(trackBy, interceptor, [execution]);

      if (key === undefined || key === null) return undefined;

      return {
        operation: metadata.id,
        problem: `the app interceptor ${interceptorName(interceptor)} can answer ${routeName} from its cache, without the contract's input checks and reply`,
        fix,
      };
    } catch (failure) {
      return {
        operation: metadata.id,
        problem: `the trackBy of the app interceptor ${interceptorName(interceptor)} threw on ${routeName}: ${failure instanceof Error ? failure.message : String(failure)}`,
        fix,
      };
    }
  }

  // The interceptors a decorator bound on a controller or a method: an instance, or the class NestJS instantiated in
  // the controller's module. A request-scoped one has no instance before a request and is not probed.
  function boundInterceptors(discovered: DiscoveredContractMethod, target: object): unknown[] {
    return metadataList(INTERCEPTORS_METADATA, target).map((binding) =>
      typeof binding === "function" ? discovered.injectables.get(binding)?.instance : binding,
    );
  }

  // NestJS appends route guards in decorator order; `moveContractGuardLast` puts the seampact guard last, and a
  // module that edits the guard list after it would let an app guard run after the access checks.
  function guardLastProblems({ name, method, metadata }: DiscoveredContractMethod): BootProblem[] {
    const guards = metadataList(GUARDS_METADATA, method);
    const index = guards.indexOf(ContractGuard);

    if (
      index !== -1 &&
      index === guards.length - 1 &&
      guards.lastIndexOf(ContractGuard) === index
    ) {
      return [];
    }

    const after = guards.slice(index + 1).filter((guard) => guard !== ContractGuard);

    return [
      {
        operation: metadata.id,
        problem: `the seampact guard is not the last guard of ${name}()${guardOrderDetail(index, after)}`,
        fix: "set the route's guards with decorators on the method, not by editing its guard metadata after the app starts",
      },
    ];
  }

  function guardOrderDetail(index: number, after: readonly unknown[]): string {
    if (index === -1) return ": the route has no seampact guard";

    return after.length === 0 ? "" : `: ${after.map(interceptorName).join(", ")} run after it`;
  }

  // Without the input param no pipe runs steps 6 to 8, and the wrapper answers 500 on every request.
  function inputParamProblems({
    prototype,
    name,
    metadata,
  }: DiscoveredContractMethod): BootProblem[] {
    const parameters: unknown = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      prototype.constructor,
      name,
    );
    const declared = (isPlainObject(parameters) ? Object.values(parameters) : []).some(
      (parameter) =>
        isPlainObject(parameter) &&
        parameter.factory === inputFactory &&
        Array.isArray(parameter.pipes) &&
        parameter.pipes.includes(contractInputPipe),
    );

    if (declared) return [];

    return [
      {
        operation: metadata.id,
        problem: `${name}() has no input parameter, so its input is never validated`,
        fix: `add the parameter \`@${metadata.id}.input() input\`, typed with the operation's generated input type`,
      },
    ];
  }

  @Catch(
    apiContractErrors(identity.contractException),
    UnauthorizedException,
    ForbiddenException,
    TooManyRequestsRefusal,
    DeclaredStatusException,
  )
  class ContractFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
      const context = boundaryContext.getStore();

      // The contract answers this exception, so it is no longer unclaimed.
      if (context !== undefined) context.unclaimedException = undefined;

      void renderContractError(host, exception);
    }
  }

  /** Writes a contract error, or a framework refusal mapped to its role, in the api's format. */
  async function renderContractError(host: ArgumentsHost, error: unknown): Promise<void> {
    const http = host.switchToHttp();
    const request: ExpressRequest = http.getRequest();
    const response: ServerResponse = http.getResponse();
    const context = boundaryContext.getStore();
    const contractError =
      context === undefined
        ? unexpectedError(undefined, error)
        : asContractError(context.route, error, throttlerRetryAfterValues(response));

    await respondWithError(
      response,
      context,
      context?.hooks ?? platform.hooks,
      api,
      context?.route,
      contractError,
      reportedRequest(request),
    );
  }

  function isContractRoute(execution: ExecutionContext): boolean {
    return (
      reflector.get<OperationMetadata | undefined>(OPERATION_METADATA, execution.getHandler())
        ?.api === api.id
    );
  }

  // The composite of one operation (ADR 0016 "Placement"), and its `input` param decorator.
  const operation = (id: string) => {
    const route = routeOf(id);
    const composite = (): MethodDecorator =>
      applyDecorators(
        contractHandler(id),
        ROUTE_DECORATORS[methodOf(route)](nestPath(route.path)),
        Version(VERSION_NEUTRAL),
        SetMetadata(OPERATION_METADATA, {
          api: api.id,
          id,
          access: route.access.kind,
        } satisfies OperationMetadata),
        UseGuards(ContractGuard),
        UseFilters(ContractFilter),
        markResponseHandled,
      );

    return Object.assign(composite, { input });
  };

  // The value NestJS extracts is ignored: the input pipe validates the request the guard recorded.
  const inputFactory = (): undefined => undefined;
  const inputDecorator = createParamDecorator(inputFactory);
  const input = (): ParameterDecorator => inputDecorator(contractInputPipe);
  // The value NestJS extracts is ignored: the param's own pipe reads the caller the guard granted.
  const accessFactory = (): undefined => undefined;
  const accessDecorator = createParamDecorator(accessFactory);

  // The caller the guard granted, read on the decorator's own operation only, so another api or route fails closed.
  function grantedAccess(id: unknown): HandlerAccess {
    const context = requireContext();
    const { grant } = guardedRequest(context);

    if (context.route.id !== id) {
      throw unexpectedError(
        context.route,
        new Error(
          `seampact: @${String(id)}.principal() or @${String(id)}.scopes() is on the method of '${context.route.id}'; use @${context.route.id}.principal() and @${context.route.id}.scopes() there.`,
        ),
      );
    }

    return handlerAccess(context.route, grant);
  }

  // A param's own pipe runs after the app's global pipes, so the value an app pipe returns never replaces these.
  @Injectable()
  class PrincipalPipe implements PipeTransform {
    transform(_value: unknown, metadata: ArgumentMetadata): unknown {
      return grantedAccess(metadata.data).principal;
    }
  }

  @Injectable()
  class ScopesPipe implements PipeTransform {
    transform(_value: unknown, metadata: ArgumentMetadata): unknown {
      return grantedAccess(metadata.data).scopes;
    }
  }

  const principalPipe = new PrincipalPipe();
  const scopesPipe = new ScopesPipe();

  // The `principal` param decorator of an operation with an identity; a public route has none.
  function principalDecorator(id: string): () => ParameterDecorator {
    if (routeOf(id).access.kind === "public") {
      throw new Error(`seampact: '${id}' is public, so its handler has no principal.`);
    }

    return () => accessDecorator(id, principalPipe);
  }

  // The `scopes` param decorator of an operation that runs in a scope.
  function scopesDecorator(id: string): () => ParameterDecorator {
    if (routeOf(id).scopes.length === 0) {
      throw new Error(`seampact: '${id}' runs in no scope, so its handler has no scopes.`);
    }

    return () => accessDecorator(id, scopesPipe);
  }

  // The app's hooks under the exported token, so a test's `overrideProvider` replaces them before they are resolved.
  function moduleOf(
    hooksProvider: Provider,
    imports: NonNullable<ModuleMetadata["imports"]>,
    moduleOptions: SeampactModuleOptions,
  ): DynamicModule {
    useRuntimeLogger(moduleOptions.logger, api);

    return {
      module: SeampactModule,
      imports: [DiscoveryModule, ...imports],
      providers: [
        hooksProvider,
        {
          provide: HOOKS,
          useFactory: (hooks: RegisteredHooks | undefined) => resolvedHooks(hooks),
          inject: [SEAMPACT_HOOKS],
        },
        { provide: MODULE_OPTIONS, useValue: moduleOptions },
        ...(options.reply === INTERCEPTOR_REPLY
          ? [{ provide: APP_INTERCEPTOR, useValue: replyInterceptor }]
          : []),
      ],
    };
  }

  @Module({})
  class SeampactModule implements NestModule, OnApplicationBootstrap {
    // Property injection with explicit tokens: no constructor parameter decorators, no design metadata.
    @Inject(HOOKS) private readonly hooks!: BoundaryHooks;
    @Inject(DiscoveryService) private readonly discovery!: DiscoveryService;
    @Inject(HttpAdapterHost) private readonly adapterHost!: HttpAdapterHost;
    @Inject(ApplicationConfig) private readonly applicationConfig!: ApplicationConfig;
    @Inject(MODULE_OPTIONS) private readonly moduleOptions!: SeampactModuleOptions;
    @Inject(ModulesContainer) private readonly modulesContainer!: ModulesContainer;

    static forRoot(...[hooks, moduleOptions = {}]: ModuleArguments<Hooks>): DynamicModule {
      return moduleOf({ provide: SEAMPACT_HOOKS, useValue: hooks ?? {} }, [], moduleOptions);
    }

    /** The module with hooks a factory builds from injected providers. */
    static forRootAsync(
      asyncHooks: SeampactModuleAsyncHooks<Hooks>,
      moduleOptions: SeampactModuleOptions = {},
    ): DynamicModule {
      return moduleOf(
        {
          provide: SEAMPACT_HOOKS,
          useFactory: asyncHooks.useFactory,
          inject: [...(asyncHooks.inject ?? [])],
        },
        asyncHooks.imports ?? [],
        moduleOptions,
      );
    }

    configure(consumer: MiddlewareConsumer): void {
      platform.adapterHost = this.adapterHost;
      platform.hooks = this.hooks;

      const contractMethods = discoveredContractMethods(this.discovery);

      moveContractGuardLast(contractMethods);
      moveReplyInterceptorFirst(this.applicationConfig);
      placeReplyCheck(contractMethods, this.applicationConfig);

      // Claimed before any api's boot check runs, so each check sees every api's routes.
      const adapter: object | undefined = this.adapterHost.httpAdapter;

      if (adapter !== undefined) {
        registerBasePathClaim(adapter, api);
        recordMiddlewareRoutes(adapter, api.routes);
      }

      consumer.apply(middleware(this.hooks)).forRoutes(
        ...api.routes.map((route) => ({
          path: nestPath(route.path),
          method: REQUEST_METHODS[methodOf(route)],
        })),
      );
    }

    onApplicationBootstrap(): void {
      const contractMethods = discoveredContractMethods(this.discovery);

      warnIgnoredInterceptorMappings(contractMethods, this.applicationConfig);
      warnUnprobedRequestScopedInterceptors(contractMethods, this.applicationConfig);

      const problems = [
        ...enforcedHookBootProblems(api, this.hooks),
        ...moduleOptionsProblems(this.moduleOptions),
        ...this.handlerProblems(contractMethods),
        ...this.unboundOperationProblems(contractMethods),
        ...this.pathPrefixProblems(contractMethods),
        ...cacheProblems(contractMethods, this.applicationConfig),
        ...this.platformProblems(),
        ...this.repeatedRegistrationProblems(),
        ...this.frameworkRouteProblems(),
      ];

      if (problems.length > 0) throw new Error(bootProblemsMessage(api, problems));
    }

    private handlerProblems(contractMethods: readonly DiscoveredContractMethod[]): BootProblem[] {
      const problems: BootProblem[] = [];

      for (const discovered of contractMethods) {
        const { prototype, name, method, metadata } = discovered;

        problems.push(
          ...writerProblems(metadata.id, prototype, name, method),
          ...replyDecoratorProblems(metadata.id, name, method),
          ...inputParamProblems(discovered),
          ...guardLastProblems(discovered),
        );
      }

      return problems;
    }

    // Under `unboundOperations: 'warn'`, a test module's operations without a controller are logged, not refused.
    private unboundOperationProblems(
      contractMethods: readonly DiscoveredContractMethod[],
    ): BootProblem[] {
      const bound = new Set(contractMethods.map((discovered) => discovered.metadata.id));
      const unbound = api.routes.filter((route) => !bound.has(route.id));

      if (unbound.length === 0) return [];

      if (this.moduleOptions.unboundOperations === WARN_UNBOUND) {
        const app = expressAppKey(this.adapterHost.httpAdapter?.getInstance());

        if (app !== undefined)
          unboundRouteIdsOfApp.set(app, new Set(unbound.map((route) => route.id)));

        runtimeLogOf(api).warn(
          `seampact: api '${api.id}' serves no controller method for ${unbound.map((route) => `'${route.id}'`).join(", ")}; their routes answer the api's 404 (unboundOperations: warn).`,
        );

        return [];
      }

      return unbound.map((route) => ({
        operation: route.id,
        problem: "no controller method carries its decorator",
        fix: `decorate a controller method with @${route.id}() and implement it, or pass \`{ ${UNBOUND_OPERATIONS_OPTION}: 'warn' }\` to forRoot in a test module`,
      }));
    }

    // The contract's paths are absolute: a controller path, a RouterModule path or a global prefix would serve them
    // elsewhere than the module middleware binds them. Each is named once.
    private pathPrefixProblems(
      contractMethods: readonly DiscoveredContractMethod[],
    ): BootProblem[] {
      const problems: BootProblem[] = [];
      const named = new Set<unknown>();

      for (const discovered of contractMethods) {
        const controller: unknown = discovered.prototype.constructor;

        if (named.has(controller)) continue;

        named.add(controller);
        problems.push(
          ...controllerPathProblems(discovered),
          ...this.routerModuleProblems(discovered),
        );
      }

      return [...problems, ...this.globalPrefixProblems()];
    }

    private routerModuleProblems({ prototype, module }: DiscoveredContractMethod): BootProblem[] {
      if (typeof module !== "function") return [];

      const modulePath: unknown =
        Reflect.getMetadata(MODULE_PATH_METADATA + this.modulesContainer.applicationId, module) ??
        Reflect.getMetadata(MODULE_PATH_METADATA, module);

      if (ROOT_PATHS.includes(modulePath)) return [];

      return [
        {
          problem: `RouterModule mounts ${module.name} under '${String(modulePath)}', which prefixes the contract routes of ${prototype.constructor.name}`,
          fix: `remove the RouterModule entry of ${module.name}, or move ${prototype.constructor.name} to a module RouterModule does not mount; the contract's paths are absolute`,
        },
      ];
    }

    private globalPrefixProblems(): BootProblem[] {
      const prefix = this.applicationConfig.getGlobalPrefix();

      if (ROOT_PATHS.includes(prefix)) return [];

      const excluded = this.applicationConfig.getGlobalPrefixOptions().exclude ?? [];

      return api.routes
        .filter((route) => !isExcludedFromPrefix(excluded, route))
        .map((route) => ({
          operation: route.id,
          problem: `setGlobalPrefix('${prefix}') prefixes ${methodOf(route).toUpperCase()} ${route.path}`,
          fix: "exclude the contract routes with setGlobalPrefix's 'exclude' option, or remove the prefix; the contract's paths are absolute",
        }));
    }

    // Every route of the Express app outside the apis' operations must be allow-listed in the app config.
    private frameworkRouteProblems(): BootProblem[] {
      if (api.frameworkRoutes.status === "off") return [];

      const adapter: AbstractHttpAdapter | undefined = this.adapterHost.httpAdapter;
      const listing = expressRouteListing(
        adapter?.getInstance(),
        boundaryRouteFilter(adapter === undefined ? [] : middlewareRoutesOf(adapter)),
      );

      return [...listing.problems, ...frameworkRouteProblems(api.frameworkRoutes, listing.routes)];
    }

    // Replies written outside a request context report to one registration's hooks: one per api in an app.
    private repeatedRegistrationProblems(): BootProblem[] {
      const adapter: unknown = this.adapterHost.httpAdapter;

      if (typeof adapter !== "object" || adapter === null) return [];

      if (bootstrappedAdapters.has(adapter)) {
        return [
          {
            problem: `the api '${api.id}' is registered twice in this app`,
            fix: "import the api's SeampactModule.forRoot(...) once in an app",
          },
        ];
      }

      bootstrappedAdapters.add(adapter);
      registerBasePathClaim(adapter, api);

      return [];
    }

    private platformProblems(): BootProblem[] {
      const platform = this.adapterHost.httpAdapter?.getType();

      return platform === EXPRESS_PLATFORM
        ? []
        : [
            {
              problem: `the NestJS platform is '${String(platform)}'; this target serves '${EXPRESS_PLATFORM}' only`,
              fix: "create the app with @nestjs/platform-express",
            },
          ];
    }
  }

  // Every api's module is its own class; its name tells them apart in NestJS's logs and errors.
  Object.defineProperty(SeampactModule, "name", { value: identity.moduleClassName });

  // The module's injected members stay private to the class; the exported type names its static side.
  const apiModule: SeampactModuleClass<Hooks> = SeampactModule;

  // NestJS decorators and parameters that write after the boundary's reply.
  function writerProblems(
    id: string,
    prototype: object,
    name: string,
    method: object,
  ): BootProblem[] {
    const problems: BootProblem[] = [];

    for (const [key, decorator] of [
      [REDIRECT_METADATA, "@Redirect"],
      [RENDER_METADATA, "@Render"],
      [SSE_METADATA, "@Sse"],
    ] as const) {
      if (Reflect.getMetadata(key, method) !== undefined) {
        problems.push({
          operation: id,
          problem: `${decorator} on ${name}() writes after the boundary's reply`,
          fix: `remove ${decorator}`,
        });
      }
    }

    const markedIndex: unknown = Reflect.getMetadata(RESPONSE_INDEX_METADATA, method);
    const parameters: unknown = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      prototype.constructor,
      name,
    );

    for (const key of isPlainObject(parameters) ? Object.keys(parameters) : []) {
      const [type, index] = key.split(":").map(Number);

      if ((type === RESPONSE_PARAM_TYPE || type === NEXT_PARAM_TYPE) && index !== markedIndex) {
        problems.push({
          operation: id,
          problem: `a @Res(), @Response() or @Next() parameter on ${name}() writes after the boundary's reply`,
          fix: "remove the parameter; return the result instead",
        });
      }
    }

    return problems;
  }

  // `@HttpCode` and `@Header` shape a reply NestJS never writes on a contract route.
  function replyDecoratorProblems(id: string, name: string, method: object): BootProblem[] {
    const problems: BootProblem[] = [];

    if (Reflect.getMetadata(HTTP_CODE_METADATA, method) !== undefined) {
      problems.push({
        operation: id,
        problem: `@HttpCode on ${name}() sets a status the boundary never writes`,
        fix: "remove @HttpCode; return the status from the handler",
      });
    }

    if (Reflect.getMetadata(HEADERS_METADATA, method) !== undefined) {
      problems.push({
        operation: id,
        problem: `@Header on ${name}() sets a header the boundary never writes`,
        fix: "remove @Header; declare the header in the contract's response",
      });
    }

    return problems;
  }

  /**
   * Renders a refusal raised before routing on a contract path, or the 404 of a path under the base path, in the
   * api's format; false when it does nothing.
   */
  // A path under a base path another api of the app also claims is left to the app's default 404.
  function claimsBasePathAloneInApp(path: string): boolean {
    const adapter: unknown = platform.adapterHost?.httpAdapter;
    const claims = typeof adapter === "object" && adapter !== null ? basePathClaimsOf(adapter) : [];

    return claimsBasePathAlone(api, claims, path);
  }

  function renderPreRoutingError(exception: unknown, host: ArgumentsHost): boolean {
    if (boundaryContext.getStore() !== undefined) return false;

    const request: ExpressRequest = host.switchToHttp().getRequest();
    const response: ServerResponse = host.switchToHttp().getResponse();
    const path = pathnameOf(request);
    const method = request.method ?? DEFAULT_METHOD;
    const notServed =
      statusOf(exception) === NOT_FOUND && matchContractRoute(api, method, path) === undefined;

    if (notServed && !api.catchAll) return false;

    if (!matchesContractPath(api, path) && !(notServed && claimsBasePathAloneInApp(path))) {
      return false;
    }

    // NestJS's 404 for a method the contract path does not serve, or a path under the base path no route serves.
    if (notServed) {
      respondNotServed(response, platform.hooks, api, { method, path }).catch((failure: unknown) =>
        logWriteFailure(api, failure),
      );

      return true;
    }

    const route = matchContractPath(api, method, path)?.route;

    void respondWithError(
      response,
      undefined,
      platform.hooks,
      api,
      route,
      preRoutingError(route, exception),
      { method, path },
    );

    return true;
  }

  // Hands an exception no api claims to NestJS's own filter, which answers and logs it as without this filter.
  @Catch(RaisedOutsideContractRoutes)
  class PreRoutingFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
      if (renderPreRoutingError(exception, host)) return;

      const httpAdapter = platform.adapterHost?.httpAdapter;

      if (httpAdapter === undefined) {
        runtimeLogOf(api).error(
          `seampact: the pre-routing filter of api '${api.id}' ran before its SeampactModule started; import SeampactModule.forRoot(...) in the app module.`,
          exception,
        );
        writeNestDefaultReply(host.switchToHttp().getResponse(), exception);

        return;
      }

      new BaseExceptionFilter(httpAdapter).catch(exception, host);
    }
  }

  const preRoutingFilter = new PreRoutingFilter();

  // What every `main.ts` and e2e setup of an app serving this api alone needs: the JSON parser at the largest route
  // limit, non-strict, keeping the raw body of signed routes, and the pre-routing filter.
  // An api without a body leaves the parser's own limit, which its routes never reach.
  function configureApp(app: ConfigurableNestApp): void {
    const largestBodyLimit = largestRouteBodyLimit(api.routes);

    app.useBodyParser("json", {
      ...(largestBodyLimit === NO_BODY_LIMIT ? {} : { limit: largestBodyLimit }),
      strict: false,
      verify: bodyGlue.keepRawBody,
    });
    app.useGlobalFilters(preRoutingFilter);
  }

  return {
    SeampactModule: apiModule,
    SEAMPACT_HOOKS,
    operation,
    principal: principalDecorator,
    scopes: scopesDecorator,
    responses: (mode: ResponsesMode) => SetMetadata(RESPONSES_METADATA, mode),
    renderContractError,
    isContractRoute,
    keepRawBody: bodyGlue.keepRawBody,
    renderPreRoutingError,
    preRoutingFilter,
    configureApp,
  };
}

// The exceptions the pre-routing filter takes, as a class NestJS's `@Catch` tests with `instanceof`: those raised
// outside any contract route. NestJS gives an exception to the first matching filter alone, and this filter is
// registered after the app's `APP_FILTER`s, so on a contract route it matches nothing and the app's filters, then
// NestJS's own, keep the exception (ADR 0016). The exception is kept there, so the outgoing check reports it if the
// reply written for it violates the contract.
// biome-ignore lint/complexity/noStaticOnlyClass: `@Catch` takes a class, and matches it by `instanceof`.
class RaisedOutsideContractRoutes {
  static [Symbol.hasInstance](value: unknown): boolean {
    const context = boundaryContext.getStore();

    if (context === undefined) return true;

    context.unclaimedException = value;

    return false;
  }
}

// The contract errors one api's filter answers, as a class NestJS's `@Catch` tests with `instanceof`: the runtime's
// own and the api's `ContractException`, never another api's, which no filter of this api answers (ADR 0016).
function apiContractErrors(
  apiContractException: NestApiIdentity["contractException"],
): Type<unknown> {
  // biome-ignore lint/complexity/noStaticOnlyClass: `@Catch` takes a class, and matches it by `instanceof`.
  return class ApiContractErrors {
    static [Symbol.hasInstance](value: unknown): boolean {
      if (!(value instanceof ContractError)) return false;

      return !(value instanceof ContractException) || value instanceof apiContractException;
    }
  };
}

// The guards or interceptors NestJS's decorators recorded on a method or a class.
function metadataList(key: string, target: object): readonly unknown[] {
  const list: unknown = Reflect.getMetadata(key, target);

  return Array.isArray(list) ? list : [];
}

// The interceptors of the app, without any api's reply interceptor.
function appInterceptors(interceptors: readonly unknown[]): unknown[] {
  return interceptors.filter(
    (interceptor) =>
      typeof interceptor !== "object" ||
      interceptor === null ||
      !Reflect.has(interceptor, REPLY_INTERCEPTOR_MARK),
  );
}

// `@Controller('tasks')` or `@Controller({ path })` prefixes every route of the controller.
function controllerPathProblems({ prototype }: DiscoveredContractMethod): BootProblem[] {
  const controllerPath: unknown = Reflect.getMetadata(PATH_METADATA, prototype.constructor);
  const paths: readonly unknown[] = Array.isArray(controllerPath)
    ? controllerPath
    : [controllerPath];

  if (paths.every((path) => ROOT_PATHS.includes(path))) return [];

  const written = paths.map((path) => `'${String(path)}'`).join(", ");
  const controller = prototype.constructor.name;

  return [
    {
      problem: `@Controller(${written}) on ${controller} prefixes the contract route`,
      fix: `use @Controller() on ${controller}, with no path; the contract's paths are absolute`,
    },
  ];
}

// NestJS's own exclusion test of `setGlobalPrefix`: a method of the route or every method, and the path's pattern.
function isExcludedFromPrefix(excluded: readonly ExcludedRoute[], route: ContractRoute): boolean {
  const method = REQUEST_METHODS[methodOf(route)];
  const path = nestPath(route.path);

  return excluded.some(
    (entry) =>
      (entry.requestMethod === RequestMethod.ALL || entry.requestMethod === method) &&
      entry.pathRegex.test(path),
  );
}

// A class NestJS can name as the controller of an execution context.
function isConstructor(value: unknown): value is Type {
  return typeof value === "function" && typeof value.prototype === "object";
}

// The request a cache interceptor's `trackBy` reads at boot: the route's method, and its path with each param
// written as its name.
function probeRequest(route: ContractRoute): object {
  const path = route.path.replace(/\{([^}]+)\}/g, "$1");

  return {
    method: methodOf(route).toUpperCase(),
    url: path,
    originalUrl: path,
    path,
    headers: {},
    query: {},
    params: {},
  };
}

function moduleOptionsProblems(moduleOptions: unknown): BootProblem[] {
  if (!isPlainObject(moduleOptions)) {
    return [
      {
        problem: "the options of SeampactModule.forRoot are not an object",
        fix: "pass `{ logger, unboundOperations }` as forRoot's second argument, or leave it out",
      },
    ];
  }

  return [
    ...Object.keys(moduleOptions)
      .filter((key) => !MODULE_OPTION_NAMES.includes(key))
      .map((key) => ({
        problem: `'${key}' is not an option of SeampactModule.forRoot`,
        fix: `remove '${key}'; forRoot takes \`{ ${MODULE_OPTION_NAMES.join(", ")} }\``,
      })),
    ...loggerProblems(moduleOptions[LOGGER_OPTION]),
    ...unboundOperationsProblems(moduleOptions[UNBOUND_OPERATIONS_OPTION]),
  ];
}

// The Express app, a function, as a weak map key.
function expressAppKey(app: unknown): object | undefined {
  return typeof app === "function" || (typeof app === "object" && app !== null) ? app : undefined;
}

function unboundOperationsProblems(value: unknown): BootProblem[] {
  if (value === undefined || UNBOUND_OPERATIONS_VALUES.includes(value)) return [];

  return [
    {
      problem: `'${UNBOUND_OPERATIONS_OPTION}' is ${JSON.stringify(value)}, not 'error' or 'warn'`,
      fix: `pass \`${UNBOUND_OPERATIONS_OPTION}: 'warn'\` in a test module, or leave it out`,
    },
  ];
}

// An interceptor or a guard is bound as its class or as an instance.
function interceptorName(interceptor: unknown): string {
  if (typeof interceptor === "function") return interceptor.name;

  if (typeof interceptor === "object" && interceptor !== null) return interceptor.constructor.name;

  return String(interceptor);
}

function methodOf(route: ContractRoute): keyof typeof ROUTE_DECORATORS {
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

  throw new Error(
    `seampact: the method '${method}' of '${route.id}' has no NestJS route decorator.`,
  );
}

function nestPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

// Applies `Res()` past both the declared and the decorated parameters, so NestJS leaves the reply to the boundary.
function markResponseHandled(
  target: object,
  key: string | symbol,
  descriptor: PropertyDescriptor,
): void {
  const method: unknown = descriptor.value;
  const declared = typeof method === "function" ? method.length : 0;
  const parameters: unknown = Reflect.getMetadata(ROUTE_ARGS_METADATA, target.constructor, key);
  const decorated = (isPlainObject(parameters) ? Object.keys(parameters) : []).map((entry) =>
    Number(entry.split(":").at(-1)),
  );
  const index = Math.max(declared, ...decorated.map((position) => position + 1));

  Res()(target, key, index);

  if (typeof method === "function") Reflect.defineMetadata(RESPONSE_INDEX_METADATA, index, method);
}

// The wrapper keeps the method's name and arity (`markResponseHandled` reads `length`) and every metadata a decorator
// written below the composite set on it (an app `@Public()`, `@Header`, `@Redirect`, which the boot check reads).
function copyMethodIdentity(
  method: { readonly name: string; readonly length: number },
  wrapped: object,
): void {
  Object.defineProperty(wrapped, "name", { value: method.name });
  Object.defineProperty(wrapped, "length", { value: method.length });

  for (const key of Reflect.getOwnMetadataKeys(method)) {
    Reflect.defineMetadata(key, Reflect.getOwnMetadata(key, method), wrapped);
  }
}

// `@nestjs/throttler` sets `Retry-After` on the response before it throws its `ThrottlerException`, a named
// throttler as `Retry-After-<name>`.
function throttlerRetryAfterValues(response: ServerResponse): string[] {
  return response
    .getHeaderNames()
    .filter((name) => name === RETRY_AFTER_HEADER || name.startsWith(`${RETRY_AFTER_HEADER}-`))
    .flatMap((name) => responseHeaderValues(response, name));
}

function asContractError(
  route: ContractRoute,
  error: unknown,
  replyRetryAfterValues: readonly string[],
): ContractError {
  if (error instanceof ContractException && !declaresCode(route, error.code)) {
    return unexpectedError(
      route,
      new Error(
        `seampact: '${route.id}' declares no code '${error.code.slice(0, MAX_LOGGED_CODE_LENGTH)}'; throw a ContractException of one of its codes.`,
      ),
    );
  }

  if (error instanceof ContractError) return error;

  if (!(error instanceof HttpException)) return unexpectedError(route, error);

  const status = error.getStatus();

  return statusError(
    route,
    status,
    error,
    NEST_STATUS_FIXES,
    refusalFacts(status, error, replyRetryAfterValues),
  );
}

function declaresCode(route: ContractRoute, code: string): boolean {
  return Object.values(route.errors).some((entry) => entry.code === code);
}

function preRoutingError(route: ContractRoute | undefined, exception: unknown): ContractError {
  const status = statusOf(exception);

  if (route === undefined || status === undefined) return unexpectedError(route, exception);

  return bodyParserError(route, status, exception);
}

function statusOf(exception: unknown): number | undefined {
  return exception instanceof HttpException ? exception.getStatus() : parserErrorStatus(exception);
}

// NestJS's default reply, as its `BaseExceptionFilter` writes it, when the filter has no HTTP adapter to delegate to.
function writeNestDefaultReply(response: ServerResponse, exception: unknown): void {
  const status = statusOf(exception) ?? INTERNAL_STATUS;
  const body =
    exception instanceof HttpException
      ? isPlainObject(exception.getResponse())
        ? exception.getResponse()
        : { statusCode: status, message: exception.getResponse() }
      : {
          statusCode: status,
          message: status === INTERNAL_STATUS ? "Internal server error" : String(exception),
        };

  if (response.headersSent) {
    response.end();

    return;
  }

  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
