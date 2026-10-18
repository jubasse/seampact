// The NestJS placement of the shared request checks (ADR 0016): the module middleware, the per-operation composite
// and input decorators, the guard, the interceptor, the narrow filter, the dynamic module with its boot check, and
// the exported helpers. Each api's generated module calls `createNestBoundary` once with its route table.
import type { IncomingMessage, ServerResponse } from "node:http";
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
import { DiscoveryModule, DiscoveryService, HttpAdapterHost, Reflector } from "@nestjs/core";
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
  matchContractRoute,
  matchesContractPath,
  type ResponsesMode,
} from "./node-server/contract-route.js";
import { handlerReply } from "./node-server/handler-reply.js";
import { beginIdempotency } from "./node-server/idempotency.js";
import { checkRestrictedInput, validateRequestInput } from "./node-server/input-checks.js";
import {
  type BoundaryContext,
  boundaryContext,
  installOutgoingCheck,
  writeContractReply,
} from "./node-server/outgoing-check.js";
import { transportRefusal } from "./node-server/transport-checks.js";

export interface NestBoundaryOptions {
  readonly responses: ResponsesMode;
  readonly bodyValidation: boolean;
}

/** The request as Express hands it to NestJS. */
interface PlatformRequest extends IncomingMessage {
  originalUrl?: string;
  body?: unknown;
  rawBody?: unknown;
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
const PAYLOAD_TOO_LARGE = 413;
const INTERNAL_STATUS = 500;
const FORBIDDEN_ROLE = "forbidden";
const UNAUTHENTICATED_ROLE = "unauthenticated";
const PAYLOAD_TOO_LARGE_ROLE = "payloadTooLarge";
const URL_BASE = "http://seampact.invalid";

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

function pathnameOf(request: PlatformRequest): string {
  return new URL(request.originalUrl ?? request.url ?? "/", URL_BASE).pathname;
}

function contractRequest(request: PlatformRequest): ContractRequest {
  const url = new URL(request.originalUrl ?? request.url ?? "/", URL_BASE);

  return {
    method: request.method ?? "GET",
    path: url.pathname,
    rawQuery: url.search.slice(1),
    headers: request.headers,
    body: request.body,
    ...(Buffer.isBuffer(request.rawBody) ? { rawBody: request.rawBody } : {}),
    ...(request.socket.remoteAddress === undefined
      ? {}
      : { clientAddress: request.socket.remoteAddress }),
  };
}

function checkState(context: BoundaryContext, request: PlatformRequest): CheckState {
  return {
    api: context.api,
    route: context.route,
    request: contractRequest(request),
    pathParams: context.pathParams,
    hooks: context.hooks,
    isFrameworkDenial,
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
  api: ContractApi,
  error: ContractError,
  request: { readonly method: string; readonly path: string },
): Promise<void> {
  if (error.unexpectedCause !== undefined) {
    const where = {
      api: api.id,
      operation: context?.route.id,
      method: request.method,
      path: request.path,
    };

    if (context?.hooks.onUnexpectedError === undefined) {
      console.error(
        `seampact: unexpected failure on operation '${where.operation ?? "(none)"}'`,
        error.unexpectedCause,
      );
    }

    await reportUnexpected(context?.hooks, error.unexpectedCause, where);
  }

  await writeContractReply(response, context, renderContractReply(api, context?.route, error));
}

/** The NestJS boundary of one api. */
export function createNestBoundary<Hooks extends BoundaryHooks>(
  api: ContractApi,
  options: NestBoundaryOptions,
) {
  const HOOKS = Symbol(`seampact:${api.id}:hooks`);
  const RESPONSES_METADATA = `seampact:${api.id}:responses`;
  const BODY_BYTES = Symbol(`seampact:${api.id}:bodyBytes`);
  const reflector = new Reflector();

  const routeOf = (id: string): ContractRoute => {
    const route = api.routes.find((candidate) => candidate.id === id);

    if (route === undefined)
      throw new Error(`seampact: the api '${api.id}' has no operation '${id}'.`);

    return route;
  };

  const middleware =
    (hooks: BoundaryHooks) =>
    (request: PlatformRequest, response: ServerResponse, next: () => void): void => {
      const path = pathnameOf(request);
      const method = request.method ?? "GET";
      const matched = matchContractRoute(api, method, path);

      if (matched === undefined) {
        console.error(
          `seampact: ${method} ${path} reached a contract route under another path; a global prefix differs from the contract's empty mount. Exclude the contract routes with setGlobalPrefix's 'exclude' option.`,
        );
        void writeContractReply(
          response,
          undefined,
          renderContractReply(api, undefined, unexpectedError(undefined, undefined)),
        );

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
      const recorded: unknown = Reflect.get(request, BODY_BYTES);

      installOutgoingCheck(response, context, { method, path });
      boundaryContext.run(context, () => {
        const refusal = transportRefusal(matched.route, contractRequest(request), {
          ...(typeof recorded === "number" ? { recordedBytes: recorded } : {}),
        });

        if (refusal === undefined) {
          next();

          return;
        }

        void respondWithError(response, context, api, refusal, { method, path });
      });
    };

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
      const request: PlatformRequest = execution.switchToHttp().getRequest();
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

  async function beforeHandler(context: BoundaryContext, request: PlatformRequest) {
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
    request: PlatformRequest,
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
    const request: PlatformRequest = http.getRequest();
    const response: ServerResponse = http.getResponse();
    const context = boundaryContext.getStore();
    const contractError =
      context === undefined
        ? unexpectedError(undefined, error)
        : asContractError(context.route, error);

    await respondWithError(response, context, api, contractError, {
      method: request.method ?? "GET",
      path: pathnameOf(request),
    });
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

  /** The verify function for `app.useBodyParser('json', { verify })` with `rawBody` off. */
  function keepRawBody(request: IncomingMessage, _response: ServerResponse, bytes: Buffer): void {
    const matched = matchContractRoute(api, request.method ?? "GET", pathnameOf(request));

    if (matched === undefined) return;

    Reflect.set(request, BODY_BYTES, bytes.byteLength);

    if (matched.route.access.kind === "identity" && matched.route.access.signed !== undefined) {
      Reflect.set(request, "rawBody", Buffer.from(bytes));
    }
  }

  /** Renders a refusal raised before routing on a contract path in the api's format; false when it does nothing. */
  function renderPreRoutingError(exception: unknown, host: ArgumentsHost): boolean {
    if (boundaryContext.getStore() !== undefined) return false;

    const request: PlatformRequest = host.switchToHttp().getRequest();
    const response: ServerResponse = host.switchToHttp().getResponse();
    const path = pathnameOf(request);

    if (!matchesContractPath(api, path)) return false;

    const route =
      matchContractRoute(api, request.method ?? "GET", path)?.route ??
      api.routes.find((candidate) => matchesContractPath({ ...api, routes: [candidate] }, path));

    void writeContractReply(
      response,
      undefined,
      renderContractReply(api, route, preRoutingError(route, exception)),
    );

    return true;
  }

  @Catch()
  class PreRoutingFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
      if (renderPreRoutingError(exception, host)) return;

      writeNestDefaultReply(host.switchToHttp().getResponse(), exception);
    }
  }

  return {
    SeampactModule,
    operation,
    responses: (mode: ResponsesMode) => SetMetadata(RESPONSES_METADATA, mode),
    renderContractError,
    isContractRoute,
    keepRawBody,
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

  if (status === PAYLOAD_TOO_LARGE) {
    const parserLimit: unknown = isPlainObject(exception) ? exception.limit : undefined;
    const routeLimit = route.input?.limitBytes;

    if (typeof parserLimit === "number" && routeLimit !== undefined && parserLimit < routeLimit) {
      console.error(
        `seampact: the JSON parser's limit (${parserLimit} bytes) is below the limit of '${route.id}' (${routeLimit} bytes); set the parser limit to the generated LARGEST_BODY_LIMIT.`,
      );

      return unexpectedError(route, exception);
    }

    const code = codeOfRole(route, PAYLOAD_TOO_LARGE_ROLE);

    return code === undefined
      ? unexpectedError(route, exception)
      : new ContractError(code, { limitBytes: routeLimit });
  }

  const code = codeOfStatus(route, status);

  return code === undefined ? unexpectedError(route, exception) : new ContractError(code);
}

function statusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();

  const status: unknown =
    isPlainObject(exception) || exception instanceof Error
      ? Reflect.get(exception, "status")
      : undefined;

  return typeof status === "number" ? status : undefined;
}

// NestJS's default reply for an exception no seampact api claims, as its `BaseExceptionFilter` writes it.
function writeNestDefaultReply(response: ServerResponse, exception: unknown): void {
  const status = exception instanceof HttpException ? exception.getStatus() : INTERNAL_STATUS;
  const body =
    exception instanceof HttpException
      ? isPlainObject(exception.getResponse())
        ? exception.getResponse()
        : { statusCode: status, message: exception.getResponse() }
      : { statusCode: INTERNAL_STATUS, message: "Internal server error" };

  if (response.headersSent) {
    response.end();

    return;
  }

  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
