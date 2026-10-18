// The error replies every Node server placement writes: a contract error reported and rendered in the api's format,
// a contract path's 404, and a framework refusal (an error carrying a 401, 403 or 429 status) mapped to its role.
// Copied into the generated tree as is.
import type { ServerResponse } from "node:http";
import { type BoundaryHooks, reportUnexpected } from "./boundary-hooks.js";
import {
  ContractError,
  codeOfRole,
  codeOfStatus,
  isPlainObject,
  renderContractReply,
  unexpectedError,
} from "./contract-error.js";
import type { ContractApi, ContractRoute } from "./contract-route.js";
import { type BoundaryContext, writeContractReply } from "./outgoing-check.js";

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const TOO_MANY_REQUESTS = 429;
const NOT_FOUND_STATUS = 404;
const UNAUTHENTICATED_ROLE = "unauthenticated";
const FORBIDDEN_ROLE = "forbidden";
const NOT_FOUND_ROLE = "notFound";

/** The request as an error report names it. */
export interface ReportedRequest {
  readonly method: string;
  readonly path: string;
}

/** Reports an unexpected failure to the hook (or the log), then writes the error in the api's format. */
export async function respondWithError(
  response: ServerResponse,
  context: BoundaryContext | undefined,
  hooks: BoundaryHooks | undefined,
  api: ContractApi,
  route: ContractRoute | undefined,
  error: ContractError,
  request: ReportedRequest,
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

/** The path's 404: the route's `notFound` code, else its code of status 404, else a 500. */
export function notFoundError(route: ContractRoute | undefined): ContractError {
  const code =
    route === undefined
      ? undefined
      : (codeOfRole(route, NOT_FOUND_ROLE) ?? codeOfStatus(route, NOT_FOUND_STATUS));

  return code === undefined
    ? unexpectedError(route, new Error("the contract path has no 404 code to answer"))
    : new ContractError(code);
}

/** The number in an error's `status` or `statusCode`, as `http-errors` and Fastify set them. */
export function errorStatus(error: unknown): number | undefined {
  if (!isPlainObject(error) && !(error instanceof Error)) return undefined;

  const status: unknown = Reflect.get(error, "status") ?? Reflect.get(error, "statusCode");

  return typeof status === "number" ? status : undefined;
}

/** Whether an error is the framework's own 401 or 403, as a decide hook may throw it. */
export function isStatusDenial(error: unknown): boolean {
  const status = errorStatus(error);

  return status === UNAUTHORIZED || status === FORBIDDEN;
}

/**
 * A framework refusal mapped to the operation's role: 401 to `unauthenticated`, 403 to `forbidden`, 429 to the
 * code of that status; a status the operation does not declare is a 500. Undefined for any other error.
 */
export function frameworkRefusal(route: ContractRoute, error: unknown): ContractError | undefined {
  const status = errorStatus(error);

  if (status !== UNAUTHORIZED && status !== FORBIDDEN && status !== TOO_MANY_REQUESTS) {
    return undefined;
  }

  const code =
    status === UNAUTHORIZED
      ? (codeOfRole(route, UNAUTHENTICATED_ROLE) ?? codeOfStatus(route, status))
      : status === FORBIDDEN
        ? (codeOfRole(route, FORBIDDEN_ROLE) ?? codeOfStatus(route, status))
        : codeOfStatus(route, status);

  return code === undefined ? unexpectedError(route, error) : new ContractError(code);
}

/** Logs a failure of a reply the boundary writes outside a framework's error path; nothing else can answer it. */
export function logWriteFailure(api: ContractApi, error: unknown): void {
  console.error(`seampact: writing a reply of api '${api.id}' failed`, error);
}
