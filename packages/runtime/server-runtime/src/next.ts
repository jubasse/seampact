// The Next.js placement of the shared request checks (ADR 0030), on the Web-standard profile: `routeHandler` runs the
// boot check when the app's catch-all route module loads and returns the route handler that serves every method of
// the api's base path, matching the raw path of `request.url` against the contract, running the shared Web steps in
// a request slot of its own and checking the reply on its way out. It renders every error itself, since Next.js has
// no error hook, and imports nothing from `next`. Each api's generated module calls `createNextBoundary` once with
// its route table.
import { refuseCodeOfOtherVersion } from "./generator-version-check.js";
import {
  type BoundaryContext,
  type BoundaryHooks,
  bootProblemsMessage,
  boundaryContext,
  type ContractApi,
  type ContractReply,
  type HandlerBindings,
  type HooksRequirement,
  type InputRuleSets,
  isUnderBasePath,
  matchContractRoute,
  type RegisteredHooks,
  type RegistrationOptions,
  type ReportedRequest,
  type ResponseSettings,
  registrationProblems,
  renderContractReply,
  reportContractError,
  resolvedHooks,
  runtimeLogOf,
  settingsOf,
  unexpectedError,
  enforcedHookBootProblems,
  useRuntimeLogger,
} from "./index.js";
import {
  checkOutgoingResponse,
  claimedWebError,
  clientAddressProblems,
  currentRequestSlot,
  errorResponse,
  notServedResponse,
  type RequestSlot,
  recordBoundaryResponse,
  runWebContractSteps,
  servedInRequestSlot,
  settledContractResponse,
  webReportedRequest,
} from "./web.js";

const BODY_READ_FIX =
  "Do not read the body of a contract route before the boundary, in a proxy.ts or a wrapper around the route handler: the boundary reads it itself.";
const NEXT_FIXES = { rawBody: BODY_READ_FIX, bodySize: BODY_READ_FIX };
const TRUNCATED_BODY_FIX =
  "A proxy.ts makes Next.js keep only the first 10 MB of a body: raise experimental.proxyClientMaxBodySize in next.config above the api's largest route limit.";
const CLIENT_ADDRESS_EXAMPLE = "(request) => request.headers.get('x-forwarded-for')?.split(',')[0]";
const EDGE_RUNTIME_GLOBAL = "EdgeRuntime";
// A route handler under Next.js receives no `Retry-After` set by a framework middleware before it.
const NO_RETRY_AFTER: readonly string[] = [];

/** The options of one api's route handler on Next.js: the shared ones and the client address of a request. */
export interface NextRouteOptions<
  Hooks,
  Handlers,
  Operation extends string,
  InputRules = InputRuleSets,
> extends RegistrationOptions<Hooks, Handlers, Operation, InputRules> {
  /** The client's address, which a `Request` does not carry, such as the first `x-forwarded-for` your proxy sets. */
  readonly clientAddress?: (request: Request) => string | undefined;
}

/** A Next.js route handler: the app exports it under every method name from the api's catch-all `route.ts`. */
export type NextRouteHandler = (request: Request, context?: unknown) => Promise<Response>;

/** The Next.js boundary of one api; throws `runtime.edge.unsupported` when the generated module loads on Edge. */
export function createNextBoundary<
  Hooks extends RegisteredHooks,
  Handlers,
  Operation extends string,
  InputRules = InputRuleSets,
>(api: ContractApi, generated: ResponseSettings, bindings: HandlerBindings) {
  refuseEdgeRuntime(api);
  refuseCodeOfOtherVersion(api);

  // The context of this api's contract request in each request slot, for `renderContractError`.
  const contexts = new WeakMap<RequestSlot, BoundaryContext>();
  // The hooks of the last route handler built, for the replies written outside a contract request.
  const registered: { hooks?: BoundaryHooks } = {};

  /** Runs the boot check and returns the route handler of the api's catch-all route file. */
  function routeHandler(
    options: NextRouteOptions<Hooks, Handlers, Operation, InputRules> & HooksRequirement<Hooks>,
  ): NextRouteHandler {
    useRuntimeLogger(options.logger, api);

    const hooks = resolvedHooks(options.hooks);
    const problems = [
      ...enforcedHookBootProblems(api, hooks),
      ...registrationProblems(api, bindings, options, generated),
      ...clientAddressProblems(options.clientAddress, CLIENT_ADDRESS_EXAMPLE),
    ];

    if (problems.length > 0) throw new Error(bootProblemsMessage(api, problems));

    registered.hooks = hooks;

    return (request) => servedInRequestSlot(() => serve(request, options, hooks));
  }

  async function serve(
    request: Request,
    options: NextRouteOptions<Hooks, Handlers, Operation, InputRules>,
    hooks: BoundaryHooks,
  ): Promise<Response> {
    const reported = webReportedRequest(request);

    if (!isUnderBasePath(api, reported.path)) return mountMismatchResponse(hooks, reported);

    const matched = matchContractRoute(api, reported.method, reported.path);

    if (matched === undefined) return notServedResponse(hooks, api, reported);

    const slot = currentRequestSlot();

    if (slot === undefined) {
      throw new Error(
        `seampact: the route handler of api '${api.id}' ran outside its request slot.`,
      );
    }

    const route = matched.route;
    const settings = settingsOf(route, bindings, options, generated);
    const context: BoundaryContext = {
      api,
      route,
      pathParams: matched.pathParams,
      hooks,
      bodyValidation: settings.bodyValidation,
      mode: settings.responses,
      boundaryWriting: false,
    };

    contexts.set(slot, context);
    slot.outgoing = (response) => checkOutgoingResponse(context, reported, response);

    return boundaryContext.run(context, () =>
      runWebContractSteps(context, {
        request,
        reported,
        clientAddress: options.clientAddress?.(request),
        handlers: options.handlers,
        inputRules: options.inputRules,
        binding: bindings[route.id],
        fixes: NEXT_FIXES,
        bodyUsedFix: BODY_READ_FIX,
        truncatedBodyFix: TRUNCATED_BODY_FIX,
        retryAfterValues: () => NO_RETRY_AFTER,
        respond: (reply) => answer(context, reply),
        unclaimed: (error) => unexpectedResponse(context, error, reported),
      }),
    );
  }

  async function answer(context: BoundaryContext, reply: ContractReply): Promise<Response> {
    const response = await settledContractResponse(context, reply);

    recordBoundaryResponse(context, response, reply);

    return response;
  }

  // Next.js turns a throw into its own HTML 500, so an error no step claims is the api's 500.
  async function unexpectedResponse(
    context: BoundaryContext,
    error: unknown,
    reported: ReportedRequest,
  ): Promise<Response> {
    const contractError = unexpectedError(context.route, error);

    await reportContractError(context.hooks, api, context.route, contractError, reported);

    return answer(context, renderContractReply(api, context.route, contractError));
  }

  // The catch-all receives only paths under its own directory, so a path under no mounted base path means the
  // entry's mount differs from where the route file sits, a Next.js `basePath` among the causes.
  function mountMismatchResponse(
    hooks: BoundaryHooks,
    reported: ReportedRequest,
  ): Promise<Response> {
    const cause = new Error(
      `seampact: the route handler of api '${api.id}' received '${reported.path}', which is under none of its base paths (${api.basePaths.join(", ")}); set the entry's 'mount' in seampact.config.yaml to the Next.js 'basePath', or move the route file under a base path of the api.`,
    );

    runtimeLogOf(api).error(cause.message);

    return errorResponse(
      undefined,
      hooks,
      api,
      undefined,
      unexpectedError(undefined, cause),
      reported,
    );
  }

  /**
   * The reply of a contract error, or a 401, 403 or 429 mapped to its role, in the api's format, for the app's own
   * Node.js code (its routes or its `proxy.ts`).
   */
  async function renderContractError(request: Request, error: unknown): Promise<Response> {
    const slot = currentRequestSlot();
    const context = slot === undefined ? undefined : contexts.get(slot);
    const reported = webReportedRequest(request);
    const route = context?.route ?? matchContractRoute(api, reported.method, reported.path)?.route;
    const contractError =
      route === undefined
        ? unexpectedError(undefined, error)
        : (claimedWebError(route, error, NO_RETRY_AFTER) ?? unexpectedError(route, error));
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

  return { routeHandler, renderContractError };
}

// Edge is deprecated by Next.js, appends the catch-all params to `request.url` in development and keeps memory
// stores per isolate; the route fails to load rather than serve.
function refuseEdgeRuntime(api: ContractApi): void {
  if (Reflect.get(globalThis, EDGE_RUNTIME_GLOBAL) === undefined) return;

  throw new Error(
    bootProblemsMessage(api, [
      {
        problem:
          "runtime.edge.unsupported: the route module loads on the Edge runtime, which this boundary does not serve",
        fix: 'export const runtime = "nodejs" from the route file',
      },
    ]),
  );
}
