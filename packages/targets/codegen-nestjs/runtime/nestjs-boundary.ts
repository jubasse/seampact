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
  renderContractReply,
  unexpectedError,
} from "./node-server/contract-error.js";
import {
  type ContractApi,
  type ContractRequest,
  type ContractRoute,
  isUnderPrefix,
  looselyMatchedRoute,
  matchContractRoute,
  matchesContractPath,
  type ResponsesMode,
} from "./node-server/contract-route.js";
import {
  bodyParserError,
  contractRequest,
  type ExpressRequest,
  expressBodyGlue,
  parserErrorStatus,
  pathnameOf,
} from "./node-server/express-platform.js";
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
const TOO_MANY_REQUESTS = 429;
const INTERNAL_STATUS = 500;
const FORBIDDEN_ROLE = "forbidden";
const UNAUTHENTICATED_ROLE = "unauthenticated";
const NOT_FOUND_ROLE = "notFound";
const NEST_FIXES: PlatformFixes = {
  rawBody:
    "NestJS keeps it as a Buffer on req.rawBody: create the app with { rawBody: true }, or pass the generated keepRawBody as the JSON parser's verify function with rawBody off.",
  bodySize:
    "Create the app with { rawBody: true }, or pass the generated keepRawBody as the JSON parser's verify function.",
};
const NOT_FOUND_STATUS = 404;

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
    const where = {
      api: api.id,
      operation: route?.id,
      method: request.method,
      path: request.path,
    };

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

  const routeOf = (id: string): ContractRoute => {
    const route = api.routes.find((candidate) => candidate.id === id);

    if (route === undefined)
      throw new Error(`seampact: the api '${api.id}' has no operation '${id}'.`);

    return route;
  };

  const middleware =
    (hooks: BoundaryHooks) =>
    (request: ExpressRequest, response: ServerResponse, next: () => void): void => {
      const path = pathnameOf(request);
      const method = request.method ?? "GET";
      const matched = matchContractRoute(api, method, path);

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

  // Express routes a path case-insensitively, with or without a trailing slash, and HEAD as GET; the contract serves
  // the path as written and no HEAD, so such a request answers the path's 404. Only a path under a prefix is a setup
  // error.
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

    const route = looselyMatchedRoute(api, request.path);

    await respondWithError(response, undefined, hooks, api, route, notFoundError(route), request);
  }

  @Injectable()
  class ContractGuard implements CanActivate {
    async canActivate(execution: ExecutionContext): Promise<boolean> {
      const context = requireContext();
      const operation = reflector.get<OperationMetadata | undefined>(
        OPERATION_METADATA,
        execution.getHandler(),
      );

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
      {
        method: request.method ?? "GET",
        path: pathnameOf(request),
      },
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

  /** Renders a refusal raised before routing on a contract path in the api's format; false when it does nothing. */
  function renderPreRoutingError(exception: unknown, host: ArgumentsHost): boolean {
    if (boundaryContext.getStore() !== undefined) return false;

    const request: ExpressRequest = host.switchToHttp().getRequest();
    const response: ServerResponse = host.switchToHttp().getResponse();
    const path = pathnameOf(request);

    if (!matchesContractPath(api, path)) return false;

    const route =
      matchContractRoute(api, request.method ?? "GET", path)?.route ??
      api.routes.find((candidate) => matchesContractPath({ ...api, routes: [candidate] }, path));

    void respondWithError(
      response,
      undefined,
      platform.hooks,
      api,
      route,
      preRoutingError(route, exception),
      {
        method: request.method ?? "GET",
        path,
      },
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

function notFoundError(route: ContractRoute | undefined): ContractError {
  const code =
    route === undefined
      ? undefined
      : (codeOfRole(route, NOT_FOUND_ROLE) ?? codeOfStatus(route, NOT_FOUND_STATUS));

  return code === undefined
    ? unexpectedError(route, new Error("the contract path has no 404 code to answer"))
    : new ContractError(code);
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
