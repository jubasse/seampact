// The NestJS placement of the shared request checks (ADR 0016): the module middleware, the per-operation composite
// and input decorators, the guard, the interceptor, the narrow filter, the dynamic module with its boot check, and
// the exported helpers. Each api's generated module calls `createNestBoundary` once with its route table.
import type { ServerResponse } from "node:http";
import {
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
  type MiddlewareConsumer,
  Module,
  type NestInterceptor,
  type NestModule,
  NotFoundException,
  type OnApplicationBootstrap,
  Patch,
  Post,
  Put,
  RequestMethod,
  Res,
  SetMetadata,
  UnauthorizedException,
  UseFilters,
  UseGuards,
  UseInterceptors,
  VERSION_NEUTRAL,
  Version,
} from "@nestjs/common";
import {
  BaseExceptionFilter,
  DiscoveryModule,
  DiscoveryService,
  HttpAdapterHost,
  Reflector,
} from "@nestjs/core";
import { from, mergeMap, type Observable, switchMap } from "rxjs";
import { authorizeRequest, type CheckState } from "./node-server/access-checks.js";
import {
  basePathClaimsOf,
  claimsBasePathAlone,
  registerBasePathClaim,
} from "./node-server/base-path-claims.js";
import {
  type BootProblem,
  type BoundaryHooks,
  bootProblemsMessage,
  hookBootProblems,
} from "./node-server/boundary-hooks.js";
import {
  ContractError,
  codeOfRole,
  codeOfStatus,
  isPlainObject,
  renderContractReply,
  unexpectedError,
} from "./node-server/contract-error.js";
import {
  type ContractApi,
  type ContractRoute,
  isUnderBasePath,
  isUnderPrefix,
  matchContractPath,
  matchContractRoute,
  matchesContractPath,
  type ResponsesMode,
} from "./node-server/contract-route.js";
import {
  logWriteFailure,
  notFoundError,
  respondNotServed,
  respondWithError,
} from "./node-server/error-reply.js";
import { handlerReply } from "./node-server/handler-reply.js";
import { beginIdempotency } from "./node-server/idempotency.js";
import { checkRestrictedInput, validateRequestInput } from "./node-server/input-checks.js";
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
} from "./node-server/node-request.js";
import {
  type BoundaryContext,
  boundaryContext,
  installOutgoingCheck,
  writeContractReply,
} from "./node-server/outgoing-check.js";
import { type PlatformFixes, transportRefusal } from "./node-server/transport-checks.js";

export interface NestBoundaryOptions {
  readonly responses: ResponsesMode;
  readonly bodyValidation: boolean;
}

interface OperationMetadata {
  readonly api: string;
  readonly id: string;
  readonly access: string;
}

// NestJS's own metadata keys and route param types, read through `Reflector` (public decorators write them).
const ROUTE_ARGS_METADATA = "__routeArguments__";
const REDIRECT_METADATA = "__redirect__";
const RENDER_METADATA = "__renderTemplate__";
const SSE_METADATA = "__sse__";
const RESPONSE_PARAM_TYPE = 1;
const NEXT_PARAM_TYPE = 2;
const OPERATION_METADATA = "seampact:operation";
const RESPONSE_INDEX_METADATA = "seampact:responseIndex";
const EXPRESS_PLATFORM = "express";
const NOT_FOUND = 404;
const TOO_MANY_REQUESTS = 429;
const INTERNAL_STATUS = 500;
const FORBIDDEN_ROLE = "forbidden";
const UNAUTHENTICATED_ROLE = "unauthenticated";
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
        "seampact: a contract route ran without its request context; import the api's SeampactModule.forRoot(...) in the app module.",
      ),
    );
  }

  return context;
}

/** The NestJS boundary of one api. */
export function createNestBoundary<Hooks extends BoundaryHooks>(
  api: ContractApi,
  options: NestBoundaryOptions,
) {
  const HOOKS = Symbol(`seampact:${api.id}:hooks`);
  const RESPONSES_METADATA = `seampact:${api.id}:responses`;
  const bodyGlue = expressBodyGlue(api);
  const reflector = new Reflector();
  // Set when the module starts: what the exported pre-routing filter and helper reach outside a request context.
  const platform: { adapterHost?: HttpAdapterHost; hooks?: BoundaryHooks } = {};
  // The HTTP adapters of the apps the module was bootstrapped in.
  const bootstrappedAdapters = new WeakSet<object>();

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

  // Express routes a path case-insensitively and with or without a trailing slash; the contract serves the path as
  // written, so such a path under the base path answers the api's 404. Only a path under a prefix is a setup error.
  async function respondUnmatched(
    response: ServerResponse,
    hooks: BoundaryHooks,
    request: { readonly method: string; readonly path: string },
  ): Promise<void> {
    if (isUnderPrefix(api, request.path)) {
      console.error(
        `seampact: ${request.method} ${request.path} reached a contract route under another path; a global prefix differs from the contract's empty mount. Exclude the contract routes with setGlobalPrefix's 'exclude' option.`,
      );
      await writeContractReply(
        response,
        undefined,
        renderContractReply(api, undefined, unexpectedError(undefined, undefined)),
      );

      return;
    }

    await respondNotServed(response, hooks, api, request);
  }

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
      context.grant = await authorizeRequest(
        checkState(context, execution.switchToHttp().getRequest()),
      );

      return true;
    }
  }

  @Injectable()
  class ContractInterceptor implements NestInterceptor {
    intercept(execution: ExecutionContext, next: CallHandler): Observable<unknown> {
      const context = requireContext();
      const request: ExpressRequest = execution.switchToHttp().getRequest();
      const response: ServerResponse = execution.switchToHttp().getResponse();

      return from(beforeHandler(context, request)).pipe(
        switchMap((replay) =>
          replay === undefined
            ? next
                .handle()
                .pipe(
                  mergeMap((result: unknown) =>
                    from(afterHandler(context, request, response, result)),
                  ),
                )
            : from(writeContractReply(response, context, replay)),
        ),
      );
    }
  }

  async function beforeHandler(context: BoundaryContext, request: ExpressRequest) {
    const grant = context.grant;

    if (grant === undefined)
      throw unexpectedError(context.route, new Error("seampact: the guard did not run"));

    const state = checkState(context, request);
    const validated = await validateRequestInput(state);
    const input = await checkRestrictedInput(state, grant, validated);

    context.input = input;

    const started = await beginIdempotency(state, grant, input);

    if (started?.outcome === "replay") return started.reply;

    if (started?.outcome === "started") context.idempotencyKey = started.key;

    return undefined;
  }

  async function afterHandler(
    context: BoundaryContext,
    request: ExpressRequest,
    response: ServerResponse,
    result: unknown,
  ): Promise<void> {
    const grant = context.grant ?? { principal: null, scopes: [] };
    const reply = await handlerReply(checkState(context, request), grant, result);

    await writeContractReply(response, context, reply);
  }

  @Catch(ContractError, UnauthorizedException, ForbiddenException, TooManyRequestsRefusal)
  class ContractFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
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
        : asContractError(context.route, error);

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
        ROUTE_DECORATORS[methodOf(route)](nestPath(route.path)),
        Version(VERSION_NEUTRAL),
        SetMetadata(OPERATION_METADATA, {
          api: api.id,
          id,
          access: route.access.kind,
        } satisfies OperationMetadata),
        UseGuards(ContractGuard),
        UseInterceptors(ContractInterceptor),
        UseFilters(ContractFilter),
        markResponseHandled,
      );

    return Object.assign(composite, { input: inputDecorator });
  };

  const inputDecorator = createParamDecorator(() => boundaryContext.getStore()?.input);

  @Module({})
  class SeampactModule implements NestModule, OnApplicationBootstrap {
    // Property injection with explicit tokens: no constructor parameter decorators, no design metadata.
    @Inject(HOOKS) private readonly hooks!: BoundaryHooks;
    @Inject(DiscoveryService) private readonly discovery!: DiscoveryService;
    @Inject(HttpAdapterHost) private readonly adapterHost!: HttpAdapterHost;

    static forRoot(hooks: Hooks): DynamicModule {
      return {
        module: SeampactModule,
        imports: [DiscoveryModule],
        providers: [{ provide: HOOKS, useValue: hooks }],
      };
    }

    configure(consumer: MiddlewareConsumer): void {
      platform.adapterHost = this.adapterHost;
      platform.hooks = this.hooks;
      consumer.apply(middleware(this.hooks)).forRoutes(
        ...api.routes.map((route) => ({
          path: nestPath(route.path),
          method: REQUEST_METHODS[methodOf(route)],
        })),
      );
    }

    onApplicationBootstrap(): void {
      const problems = [
        ...hookBootProblems(api, this.hooks),
        ...this.handlerProblems(),
        ...this.platformProblems(),
        ...this.repeatedRegistrationProblems(),
      ];

      if (problems.length > 0) throw new Error(bootProblemsMessage(api, problems));
    }

    private handlerProblems(): BootProblem[] {
      const bound = new Set<string>();
      const problems: BootProblem[] = [];

      for (const wrapper of this.discovery.getControllers()) {
        const instance: unknown = wrapper.instance;

        if (!isPlainObject(instance) && typeof instance !== "object") continue;

        const prototype: unknown = Object.getPrototypeOf(instance);

        if (prototype === null || typeof prototype !== "object") continue;

        for (const name of Object.getOwnPropertyNames(prototype)) {
          const method: unknown = Reflect.get(prototype, name);

          if (typeof method !== "function") continue;

          const metadata = reflector.get<OperationMetadata | undefined>(OPERATION_METADATA, method);

          if (metadata?.api !== api.id) continue;

          bound.add(metadata.id);
          problems.push(...writerProblems(metadata.id, prototype, name, method));
        }
      }

      for (const route of api.routes) {
        if (!bound.has(route.id)) {
          problems.push({
            operation: route.id,
            problem: "no controller method carries its decorator",
            fix: `decorate a controller method with @${route.id}() and implement it`,
          });
        }
      }

      return problems;
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
  @Catch()
  class PreRoutingFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
      if (renderPreRoutingError(exception, host)) return;

      const context = boundaryContext.getStore();

      // On a contract route the outgoing check reports this exception if NestJS's reply violates the contract.
      if (context !== undefined) context.unclaimedException = exception;

      const httpAdapter = platform.adapterHost?.httpAdapter;

      if (httpAdapter === undefined) {
        console.error(
          `seampact: the pre-routing filter of api '${api.id}' ran before its SeampactModule started; import SeampactModule.forRoot(...) in the app module.`,
          exception,
        );
        writeNestDefaultReply(host.switchToHttp().getResponse(), exception);

        return;
      }

      new BaseExceptionFilter(httpAdapter).catch(exception, host);
    }
  }

  return {
    SeampactModule,
    operation,
    responses: (mode: ResponsesMode) => SetMetadata(RESPONSES_METADATA, mode),
    renderContractError,
    isContractRoute,
    keepRawBody: bodyGlue.keepRawBody,
    renderPreRoutingError,
    preRoutingFilter: new PreRoutingFilter(),
  };
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

function asContractError(route: ContractRoute, error: unknown): ContractError {
  if (error instanceof ContractError) return error;

  const code =
    error instanceof UnauthorizedException
      ? codeOfRole(route, UNAUTHENTICATED_ROLE)
      : error instanceof ForbiddenException
        ? codeOfRole(route, FORBIDDEN_ROLE)
        : error instanceof HttpException
          ? codeOfStatus(route, error.getStatus())
          : undefined;

  return code === undefined ? unexpectedError(route, error) : new ContractError(code);
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
