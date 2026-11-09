// The steps of one contract request every Web-standard placement runs (ADR 0020, ADR 0030 "Placement"): the media
// type, the bounded body read, the access steps, step 8b, the handler call and its reply, then the claim of an error
// in the api's format. The placement gives the response its framework writes and what it does with an error no
// step claims.
import { authorizeRequest, type CheckState } from "./access-checks.js";
import type { BoundaryContext } from "./boundary-context.js";
import type { BootProblem } from "./boundary-hooks.js";
import {
  ContractError,
  type ContractReply,
  renderContractReply,
  unexpectedError,
} from "./contract-error.js";
import type { ContractRequest, ContractRoute } from "./contract-route.js";
import {
  frameworkRefusal,
  isStatusDenial,
  type ReportedRequest,
  reportContractError,
} from "./error-reply.js";
import { type HandlerBinding, handlerResultReply, runInputSteps } from "./handler-map.js";
import { mediaTypeRefusal, type PlatformFixes } from "./transport-checks.js";
import { type ReadRequestBody, readContractBody, webContractRequest } from "./web-request.js";

const NO_BODY: ReadRequestBody = { body: undefined };

/** What one Web-standard placement gives the shared steps of a contract request. */
export interface WebContractSteps {
  readonly request: Request;
  readonly reported: ReportedRequest;
  readonly clientAddress: string | undefined;
  /** The app's handler map and input rules, as registered. */
  readonly handlers: unknown;
  readonly inputRules: unknown;
  readonly binding: HandlerBinding | undefined;
  readonly fixes: PlatformFixes;
  /** The fix a 500 names when app code read the body before the boundary. */
  readonly bodyUsedFix: string;
  /** The fix a 500 names when the platform cut the body short of its declared length; absent where none can. */
  readonly truncatedBodyFix?: string;
  /** The `Retry-After` values a framework middleware set before raising its 429. */
  retryAfterValues(): readonly string[];
  /** The response the framework sends for a reply of the boundary. */
  respond(reply: ContractReply): Promise<Response>;
  /** What the placement answers for an error no step claims, kept on the context for `onUnexpectedError`. */
  unclaimed(error: unknown): Promise<Response>;
}

/** Runs steps 1 to 10 of one contract request and answers it, or hands an unclaimed error to the placement. */
export async function runWebContractSteps(
  context: BoundaryContext,
  steps: WebContractSteps,
): Promise<Response> {
  const route = context.route;

  try {
    if (steps.binding === undefined) {
      throw unexpectedError(route, new Error(`seampact: '${route.id}' has no handler binding`));
    }

    const mediaRefusal = mediaTypeRefusal(
      route,
      webContractRequest(steps.request, NO_BODY, undefined),
    );

    if (mediaRefusal !== undefined) throw mediaRefusal;

    const read = await readContractBody(
      route,
      steps.request,
      steps.bodyUsedFix,
      steps.truncatedBodyFix,
    );
    const state = webCheckState(
      context,
      webContractRequest(steps.request, read, steps.clientAddress),
      steps.fixes,
    );

    context.grant = await authorizeRequest(state);

    const started = await runInputSteps(state, context, steps.inputRules);
    const reply =
      started?.replay ?? (await handlerResultReply(state, context, steps.handlers, steps.binding));

    return await steps.respond(reply);
  } catch (error) {
    const claimed = claimedWebError(route, error, steps.retryAfterValues());

    if (claimed === undefined) {
      context.unclaimedException = error;

      return steps.unclaimed(error);
    }

    await reportContractError(context.hooks, context.api, route, claimed, steps.reported);

    return steps.respond(renderContractReply(context.api, route, claimed));
  }
}

/** A contract error as is, or a 401, 403 or 429 a framework raised mapped to its role; undefined for any other. */
export function claimedWebError(
  route: ContractRoute,
  error: unknown,
  retryAfterValues: readonly string[],
): ContractError | undefined {
  if (error instanceof ContractError) return error;

  return frameworkRefusal(route, error, retryAfterValues);
}

function webCheckState(
  context: BoundaryContext,
  request: ContractRequest,
  fixes: PlatformFixes,
): CheckState {
  return {
    api: context.api,
    route: context.route,
    request,
    pathParams: context.pathParams,
    hooks: context.hooks,
    isFrameworkDenial: isStatusDenial,
    fixes,
  };
}

/** The boot problem of a `clientAddress` option that is not a function; `example` shows one in the fix. */
export function clientAddressProblems(clientAddress: unknown, example: string): BootProblem[] {
  if (clientAddress === undefined || typeof clientAddress === "function") return [];

  return [
    {
      problem: "'clientAddress' is not a function",
      fix: `pass a function of the request, such as ${example}, or leave it out`,
    },
  ];
}
