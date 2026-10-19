// The Fastify placement of the shared request checks (ADR 0017): an encapsulated plugin per api with one route per
// operation, most specific first, whose route hooks run step 1, the decoding of a compressed body, the access steps
// and the input steps around the handler; the plugin's JSON parser and narrow error handler; the boot check; and the
// exported helpers for the requests the plugin never sees. Each api's generated module calls
// `createFastifyBoundary` once with its route table.
import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough, type Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type {
  FastifyError,
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
  RouteHandlerMethod,
} from "fastify";
import { authorizeRequest, type CheckState } from "./node-server/access-checks.js";
import {
  type BootProblem,
  type BoundaryHooks,
  bootProblemsMessage,
  hookBootProblems,
} from "./node-server/boundary-hooks.js";
import {
  ContractError,
  type ContractReply,
  roleError,
  unexpectedError,
} from "./node-server/contract-error.js";
import {
  type ContractApi,
  type ContractRequest,
  type ContractRoute,
  headerValue,
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
  respondUnservedMethod,
  respondWithError,
} from "./node-server/error-reply.js";
import {
  type HandlerBindings,
  handlerResultReply,
  type RegistrationOptions,
  type ResponseSettings,
  registrationProblems,
  runInputSteps,
  settingsOf,
} from "./node-server/handler-map.js";
import { validateRequestInput } from "./node-server/input-checks.js";
import {
  bodyParserError,
  contractRequest,
  pathnameOf,
  reportedRequest,
} from "./node-server/node-request.js";
import {
  type BoundaryContext,
  boundaryContext,
  installOutgoingCheck,
  writeContractReply,
} from "./node-server/outgoing-check.js";
import {
  bodySizeRefusal,
  IDENTITY_ENCODING,
  mediaTypeRefusal,
  type PlatformFixes,
} from "./node-server/transport-checks.js";

const FASTIFY_FIXES: PlatformFixes = {
  rawBody:
    "The plugin's own JSON parser keeps it: register the plugin as generated, not wrapped with fastify-plugin.",
  bodySize:
    "The plugin's own JSON parser records it: register the plugin as generated, not wrapped with fastify-plugin.",
};
const SUPPORTED_MAJOR = "5";
const JSON_MEDIA = "application/json";
const ANY_MEDIA = "*";
const UNSUPPORTED_MEDIA_ROLE = "unsupportedMediaType";
const UTF8_CHARSETS: readonly string[] = ["utf-8", "utf8"];
const BAD_REQUEST = 400;
const CLIENT_ERROR_FLOOR = 400;
const SERVER_ERROR_FLOOR = 500;
const CONTENT_TYPE_PARSER_ERROR_PREFIX = "FST_ERR_CTP_";
// Fastify's router writes these itself unless the app routes them through `frameworkErrors`.
const ROUTER_ERROR_CODES: readonly string[] = ["FST_ERR_BAD_URL", "FST_ERR_MAX_PARAM_LENGTH"];
const DECODERS: Readonly<Record<string, () => NodeJS.ReadWriteStream>> = {
  gzip: createGunzip,
  deflate: createInflate,
  br: createBrotliDecompress,
};

/** The request body the plugin's parser read: its byte count, and its raw bytes on a signed route. */
interface ReadBody {
  readonly bytes: number;
  readonly raw?: Buffer;
}

/** The Fastify boundary of one api. */
export function createFastifyBoundary<
  Hooks extends BoundaryHooks,
  Handlers,
  Operation extends string,
>(api: ContractApi, generated: ResponseSettings, bindings: HandlerBindings) {
  const operationConfigKey = `seampact:${api.id}:operation`;
  // The context of each contract request, for the parser, the error handler and `renderContractError`.
  const contexts = new WeakMap<IncomingMessage, BoundaryContext>();
  const readBodies = new WeakMap<IncomingMessage, ReadBody>();
  // The hooks of the last plugin registered, for the replies written outside a request context.
  const registered: { hooks?: BoundaryHooks } = {};
  // The apps' servers the plugin is registered in: one registration per app, so replies outside a request context
  // report to one set of hooks.
  const registeredServers = new WeakSet<object>();

  const plugin: FastifyPluginAsync<RegistrationOptions<Hooks, Handlers, Operation>> = async (
    fastify,
    options: RegistrationOptions<Hooks, Handlers, Operation>,
  ): Promise<void> => {
    const problems = [
      ...hookBootProblems(api, options.hooks),
      ...registrationProblems(api, bindings, options, generated),
      ...instanceProblems(fastify),
    ];

    if (problems.length > 0) throw new Error(bootProblemsMessage(api, problems));

    registeredServers.add(fastify.server);
    warnUnboundedParams();
    registered.hooks = options.hooks;
    replaceJsonParsers(fastify);
    fastify.setErrorHandler(contractErrorHandler(options));

    for (const route of api.routes) registerRoute(fastify, route, options);
  };

  function instanceProblems(fastify: FastifyInstance): BootProblem[] {
    const problems: BootProblem[] = [];
    const major = fastify.version.split(".")[0];

    if (major !== SUPPORTED_MAJOR) {
      problems.push({
        problem: `Fastify is ${fastify.version}; this target serves Fastify ${SUPPORTED_MAJOR} only`,
        fix: `install fastify ${SUPPORTED_MAJOR}`,
      });
    }

    if (registeredServers.has(fastify.server)) {
      problems.push({
        problem: `the api '${api.id}' is registered twice in this app`,
        fix: "register the plugin once per api in an app",
      });
    }

    if (fastify.prefix !== "") {
      problems.push({
        problem: `the plugin is registered under the prefix '${fastify.prefix}', which differs from the contract's empty mount`,
        fix: "register the plugin without a prefix",
      });
    }

    const maxParamLength = fastify.initialConfig.maxParamLength ?? Number.POSITIVE_INFINITY;

    for (const route of api.routes) {
      for (const param of route.params.path) {
        if (param.encodedMaxLength !== undefined && param.encodedMaxLength > maxParamLength) {
          problems.push({
            operation: route.id,
            problem: `the path param '${param.name}' may take ${param.encodedMaxLength} characters percent-encoded, above the router's maxParamLength of ${maxParamLength}`,
            fix: `create the Fastify instance with maxParamLength: ${param.encodedMaxLength} or more`,
          });
        }
      }
    }

    return problems;
  }

  function warnUnboundedParams(): void {
    const unbounded = api.routes.flatMap((route) =>
      route.params.path
        .filter((param) => param.encodedMaxLength === undefined)
        .map((param) => `${route.id}.${param.name}`),
    );

    if (unbounded.length === 0) return;

    console.warn(
      `seampact: the path params ${[...new Set(unbounded)].join(", ")} of api '${api.id}' declare no maxLength and are not uuids, so a value longer than the router's maxParamLength answers 414; route it through renderPreRoutingError in frameworkErrors to answer it in the api's format.`,
    );
  }

  // The plugin's own parser for the JSON media its routes declare and any other, in place of the inherited ones.
  function replaceJsonParsers(fastify: FastifyInstance): void {
    const declared = new Set(
      api.routes.flatMap((route) => (route.input === undefined ? [] : [route.input.media])),
    );

    for (const media of [JSON_MEDIA, ...declared, ANY_MEDIA]) {
      if (fastify.hasContentTypeParser(media)) fastify.removeContentTypeParser(media);
    }

    for (const media of [...new Set([JSON_MEDIA, ...declared]), ANY_MEDIA]) {
      fastify.addContentTypeParser(media, { parseAs: "buffer" }, parseContractBody);
    }
  }

  function parseContractBody(
    request: FastifyRequest,
    body: Buffer | string,
    done: (error: Error | null, body?: unknown) => void,
  ): void {
    const context = contexts.get(request.raw);

    if (context?.route.input === undefined) {
      done(null, undefined);

      return;
    }

    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const access = context.route.access;

    readBodies.set(request.raw, {
      bytes: bytes.byteLength,
      ...(access.kind === "identity" && access.signed !== undefined
        ? { raw: Buffer.from(bytes) }
        : {}),
    });

    const charset = charsetOf(headerValue(request.headers, "content-type"));

    if (charset !== undefined && !UTF8_CHARSETS.includes(charset)) {
      done(roleError(context.route, UNSUPPORTED_MEDIA_ROLE));

      return;
    }

    if (bytes.byteLength === 0) {
      done(null, undefined);

      return;
    }

    try {
      done(null, JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      done(bodyParserError(context.route, BAD_REQUEST, error));
    }
  }

  function registerRoute(
    fastify: FastifyInstance,
    route: ContractRoute,
    options: RegistrationOptions<Hooks, Handlers, string>,
  ): void {
    const settings = settingsOf(route, bindings, options, generated);
    const binding = bindings[route.id];
    const handler: RouteHandlerMethod = async (request, reply) => {
      const context = requireContext(request, route);

      if (binding === undefined) {
        throw unexpectedError(route, new Error(`seampact: '${route.id}' has no handler binding`));
      }

      const contractReply = await boundaryContext.run(context, () =>
        handlerResultReply(checkState(context, request), context, options.handlers, binding),
      );

      await sendContractReply(reply, context, contractReply);
    };

    fastify.route({
      method: route.method.toUpperCase(),
      url: fastifyPath(route.path),
      ...(route.input === undefined ? {} : { bodyLimit: route.input.limitBytes }),
      config: { [operationConfigKey]: route.id },
      onRequest: (request, reply, done) => {
        enterRoute(route, settings, options.hooks, request, reply, done);
      },
      preParsing: async (request, _reply, payload) => decodedPayload(request, payload),
      preValidation: async (request) => {
        const context = requireContext(request, route);
        const refusal = bodySizeRefusal(context.route, fastifyRequest(request), {
          ...recordedBytesOf(request),
          fixes: FASTIFY_FIXES,
        });

        if (refusal !== undefined) throw refusal;

        context.grant = await boundaryContext.run(context, () =>
          authorizeRequest(checkState(context, request)),
        );
      },
      preHandler: async (request, reply) => {
        const context = requireContext(request, route);
        const started = await boundaryContext.run(context, () =>
          runInputSteps(checkState(context, request), context),
        );

        if (started !== undefined) await sendContractReply(reply, context, started.replay);
      },
      handler,
    });
  }

  // Step 1 before the body: the request context, the outgoing check on the raw response and the media type.
  function enterRoute(
    route: ContractRoute,
    settings: ResponseSettings,
    hooks: BoundaryHooks,
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void {
    const reported = reportedRequest(request.raw);
    const matched = matchContractRoute(api, reported.method, reported.path);

    // HEAD runs through the GET route; the contract serves no HEAD.
    if (matched === undefined && matchesContractPath(api, reported.path)) {
      respondUnserved(reply, hooks, reported);

      return;
    }

    // A path only Fastify's relaxed routing accepts: the contract does not serve it as sent. Fastify decodes a
    // percent-encoded static segment, so it can route to another operation than the raw path names: the path's 404
    // then, so no handler runs under another operation's access and input.
    if (matched === undefined || matched.route.id !== route.id) {
      writeDetached(reply, hooks, route, notFoundError(route), reported);

      return;
    }

    const context = openContext(matched.route, matched.pathParams, settings, hooks, request, reply);

    boundaryContext.run(context, () => {
      done(mediaTypeRefusal(matched.route, fastifyRequest(request)));
    });
  }

  function openContext(
    route: ContractRoute,
    pathParams: Readonly<Record<string, string>>,
    settings: ResponseSettings,
    hooks: BoundaryHooks,
    request: FastifyRequest,
    reply: FastifyReply,
  ): BoundaryContext {
    const context: BoundaryContext = {
      api,
      route,
      pathParams,
      hooks,
      bodyValidation: settings.bodyValidation,
      mode: settings.responses,
      boundaryWriting: false,
    };

    contexts.set(request.raw, context);
    installOutgoingCheck(reply.raw, context, reportedRequest(request.raw));

    return context;
  }

  // Inflates a gzip, deflate or br body, as the Express-platform parsers do; `bodyLimit` bounds both lengths.
  function decodedPayload(request: FastifyRequest, payload: Readable): Readable {
    const encoding = headerValue(request.headers, "content-encoding")?.trim().toLowerCase();

    if (encoding === undefined || encoding === IDENTITY_ENCODING) return payload;

    const route = contexts.get(request.raw)?.route;
    const decoder = DECODERS[encoding];

    if (decoder === undefined) {
      throw route === undefined
        ? new Error("seampact: the request's content coding is not supported")
        : roleError(route, UNSUPPORTED_MEDIA_ROLE);
    }

    const decoding = decoder();
    const decoded = new PassThrough();
    let encodedLength = 0;

    payload.on("data", (chunk: Buffer) => {
      encodedLength += chunk.byteLength;
      Reflect.set(decoded, "receivedEncodedLength", encodedLength);
    });
    decoding.on("error", (error) => {
      decoded.destroy(route === undefined ? error : bodyParserError(route, BAD_REQUEST, error));
    });
    payload.pipe(decoding).pipe(decoded);

    return decoded;
  }

  function requireContext(request: FastifyRequest, route: ContractRoute): BoundaryContext {
    const context = contexts.get(request.raw);

    if (context === undefined) {
      throw unexpectedError(
        route,
        new Error(
          `seampact: a route of api '${api.id}' ran without its request context; register the generated plugin as is.`,
        ),
      );
    }

    return context;
  }

  function checkState(context: BoundaryContext, request: FastifyRequest): CheckState {
    return {
      api: context.api,
      route: context.route,
      request: fastifyRequest(request),
      pathParams: context.pathParams,
      hooks: context.hooks,
      isFrameworkDenial: isStatusDenial,
      fixes: FASTIFY_FIXES,
    };
  }

  function fastifyRequest(request: FastifyRequest): ContractRequest {
    const read = readBodies.get(request.raw);

    return {
      ...contractRequest(request.raw),
      body: request.body,
      ...(read?.raw === undefined ? {} : { rawBody: read.raw }),
    };
  }

  function recordedBytesOf(request: FastifyRequest): { recordedBytes?: number } {
    const read = readBodies.get(request.raw);

    return read === undefined ? {} : { recordedBytes: read.bytes };
  }

  // A contract error, a refusal of the route's body read, or a 401, 403 or 429 is answered; anything else is
  // rethrown to the app's error handler, with the outgoing check installed so its reply is checked.
  function contractErrorHandler(options: RegistrationOptions<Hooks, Handlers, string>) {
    const hooks = options.hooks;

    return async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      let context = contexts.get(request.raw);
      const route = context?.route ?? configuredRoute(request);

      if (route === undefined) throw error;

      const claimed = claimedError(route, error);

      if (claimed === undefined) {
        context ??= openContext(
          route,
          matchContractPath(api, route.method, pathnameOf(request.raw))?.pathParams ?? {},
          settingsOf(route, bindings, options, generated),
          hooks,
          request,
          reply,
        );
        context.unclaimedException = error;

        throw error;
      }

      await sendError(reply, context, context?.hooks ?? hooks, route, claimed);
    };
  }

  function configuredRoute(request: FastifyRequest): ContractRoute | undefined {
    const config: unknown = request.routeOptions.config;
    const id: unknown =
      typeof config === "object" && config !== null
        ? Reflect.get(config, operationConfigKey)
        : undefined;

    return api.routes.find((route) => route.id === id);
  }

  // Copies the headers set on the reply so far onto the raw response, then hands the response to the boundary.
  function hijackForBoundary(reply: FastifyReply): ServerResponse {
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined && !reply.raw.headersSent) reply.raw.setHeader(name, value);
    }

    reply.hijack();

    return reply.raw;
  }

  async function sendContractReply(
    reply: FastifyReply,
    context: BoundaryContext,
    contractReply: ContractReply,
  ): Promise<void> {
    await writeContractReply(hijackForBoundary(reply), context, contractReply);
  }

  async function sendError(
    reply: FastifyReply,
    context: BoundaryContext | undefined,
    hooks: BoundaryHooks | undefined,
    route: ContractRoute | undefined,
    error: ContractError,
  ): Promise<void> {
    await respondWithError(
      hijackForBoundary(reply),
      context,
      hooks,
      api,
      route,
      error,
      reportedRequest(reply.request.raw),
    );
  }

  function respondUnserved(
    reply: FastifyReply,
    hooks: BoundaryHooks | undefined,
    reported: ReportedRequest,
  ): void {
    respondUnservedMethod(hijackForBoundary(reply), hooks, api, reported).catch(
      (failure: unknown) => logWriteFailure(api, failure),
    );
  }

  function writeDetached(
    reply: FastifyReply,
    hooks: BoundaryHooks | undefined,
    route: ContractRoute | undefined,
    error: ContractError,
    reported: ReportedRequest,
  ): void {
    respondWithError(hijackForBoundary(reply), undefined, hooks, api, route, error, reported).catch(
      (failure: unknown) => logWriteFailure(api, failure),
    );
  }

  /** Writes a contract error, or a framework refusal mapped to its role, in the api's format. */
  function renderContractError(reply: FastifyReply, error: unknown): Promise<void> {
    const context = contexts.get(reply.request.raw);
    const route = context?.route ?? configuredRoute(reply.request);
    const contractError =
      route === undefined
        ? unexpectedError(undefined, error)
        : (claimedError(route, error) ?? unexpectedError(route, error));

    return sendError(reply, context, context?.hooks ?? registered.hooks, route, contractError);
  }

  /**
   * On a contract path the plugin never saw: without an error the path's 404, and for Fastify's router errors
   * (`FST_ERR_BAD_URL`, `FST_ERR_MAX_PARAM_LENGTH`) the operation's step 6 refusal; false when it does nothing.
   */
  function renderPreRoutingError(
    request: FastifyRequest,
    reply: FastifyReply,
    error?: unknown,
  ): boolean {
    if (contexts.has(request.raw)) return false;

    const reported = reportedRequest(request.raw);

    const matched = matchContractPath(api, reported.method, reported.path);

    if (matched === undefined) return false;

    if (
      error === undefined &&
      matchContractRoute(api, reported.method, reported.path) === undefined
    ) {
      respondUnserved(reply, registered.hooks, reported);

      return true;
    }

    if (error === undefined) {
      writeDetached(reply, registered.hooks, matched.route, notFoundError(matched.route), reported);

      return true;
    }

    if (!isRouterError(error)) return false;

    pathParamRefusal(matched.route, matched.pathParams, request)
      .then((refusal) => writeDetached(reply, registered.hooks, matched.route, refusal, reported))
      .catch((failure: unknown) => logWriteFailure(api, failure));

    return true;
  }

  // Step 6 on the path params Fastify's router refused; a value the contract accepts is a setup error.
  async function pathParamRefusal(
    route: ContractRoute,
    pathParams: Readonly<Record<string, string>>,
    request: FastifyRequest,
  ): Promise<ContractError> {
    const hooks = registered.hooks;

    if (hooks === undefined) {
      return unexpectedError(
        route,
        new Error(`seampact: the plugin of api '${api.id}' is not registered`),
      );
    }

    try {
      await validateRequestInput({
        api,
        route,
        request: contractRequest(request.raw),
        pathParams,
        hooks,
        isFrameworkDenial: isStatusDenial,
        fixes: FASTIFY_FIXES,
      });
    } catch (refusal) {
      if (refusal instanceof ContractError) return refusal;

      return unexpectedError(route, refusal);
    }

    return unexpectedError(
      route,
      new Error(
        `seampact: Fastify's router refused a path param of '${route.id}' the contract accepts; raise the instance's maxParamLength.`,
      ),
    );
  }

  /** True on a request a contract route of the api serves, for an app root hook that skips them. */
  function isContractRoute(request: FastifyRequest): boolean {
    const reported = reportedRequest(request.raw);

    return matchContractRoute(api, reported.method, reported.path) !== undefined;
  }

  return {
    plugin,
    renderContractError,
    renderPreRoutingError,
    isContractRoute,
  };
}

function claimedError(route: ContractRoute, error: unknown): ContractError | undefined {
  if (error instanceof ContractError) return error;

  if (isBodyReadRefusal(error)) return bodyParserError(route, error.statusCode, error);

  return frameworkRefusal(route, error);
}

// Every 4xx `FST_ERR_CTP_*` the route's body read raises: too large, a bad media type or content length.
function isBodyReadRefusal(error: unknown): error is { readonly statusCode: number } {
  if (!(error instanceof Error)) return false;

  const code: unknown = Reflect.get(error, "code");
  const status: unknown = Reflect.get(error, "statusCode");

  return (
    typeof code === "string" &&
    code.startsWith(CONTENT_TYPE_PARSER_ERROR_PREFIX) &&
    typeof status === "number" &&
    status >= CLIENT_ERROR_FLOOR &&
    status < SERVER_ERROR_FLOOR
  );
}

function isRouterError(error: unknown): boolean {
  const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;

  return typeof code === "string" && ROUTER_ERROR_CODES.includes(code);
}

function charsetOf(contentType: string | undefined): string | undefined {
  const parameter = contentType
    ?.split(";")
    .slice(1)
    .map((part) => part.trim().toLowerCase())
    .find((part) => part.startsWith("charset="));

  return parameter?.slice("charset=".length).replace(/^"|"$/g, "");
}

// Fastify's syntax with positional param names, a literal `:` doubled; the generator refuses a segment that mixes a
// placeholder with literal text, which find-my-way would read as one param.
function fastifyPath(template: string): string {
  let position = 0;

  return template
    .split(/(\{[^}]+\})/)
    .map((part) => {
      if (part.startsWith("{") && part.endsWith("}")) {
        position += 1;

        return `:p${position}`;
      }

      return part.replaceAll(":", "::");
    })
    .join("");
}
