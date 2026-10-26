// The error replies every server placement renders: a contract error reported to the hook or the log, the 404 of a
// request the api does not serve (a bare one when no operation can answer it), and a thrown HTTP status (a framework
// refusal of 401, 403 or 429 among them) mapped to the operation's code. Copied into the generated tree as is.
import { type BoundaryHooks, reportUnexpected } from "./boundary-hooks.js";
import { ContractError, codeOfRole, codeOfStatus, unexpectedError } from "./contract-error.js";
import { type ContractApi, type ContractRoute, matchesContractPath } from "./contract-route.js";
import { isPlainObject } from "./plain-object.js";
import { runtimeLog } from "./runtime-logger.js";

/** The status of a request the api does not serve. */
export const NOT_FOUND_STATUS = 404;

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const TOO_MANY_REQUESTS = 429;
const NOT_FOUND_ROLE = "notFound";
// The roles a status takes before its status alone, as the PHP targets map `abort()`.
const STATUS_ROLES: Readonly<Record<number, string>> = {
  401: "unauthenticated",
  403: "forbidden",
  429: "rateLimited",
  503: "serviceUnavailable",
};
const FRAMEWORK_REFUSAL_FIXES: StatusErrorFixes = {
  requiredParams: "answer that code from the handler with its params",
  severalCodes: "answer the one it means from the handler",
};

/** How the placement tells the app to answer a status the boundary cannot map to one code alone. */
export interface StatusErrorFixes {
  readonly requiredParams: string;
  readonly severalCodes: string;
}

/** The request as an error report names it. */
export interface ReportedRequest {
  readonly method: string;
  readonly path: string;
}

/** Reports the unexpected failure behind a contract error to the hook, or the log when none is registered. */
export async function reportContractError(
  hooks: BoundaryHooks | undefined,
  api: ContractApi,
  route: ContractRoute | undefined,
  error: ContractError,
  request: ReportedRequest,
): Promise<void> {
  if (error.unexpectedCause === undefined) return;

  const where = {
    api: api.id,
    operation: route?.id,
    method: request.method,
    path: request.path,
  };

  if (hooks?.onUnexpectedError === undefined) {
    runtimeLog.error(
      `seampact: unexpected failure on operation '${where.operation ?? "(none)"}'`,
      error.unexpectedCause,
    );
  }

  await reportUnexpected(hooks, error.unexpectedCause, where);
}

/** The path's 404: the route's `notFound` code, else its code of status 404, else a 500. */
export function notFoundError(route: ContractRoute | undefined): ContractError {
  const code = route === undefined ? undefined : notFoundCodeOf(route);

  return code === undefined
    ? unexpectedError(route, new Error("the contract path has no 404 code to answer"))
    : new ContractError(code);
}

function notFoundCodeOf(route: ContractRoute): string | undefined {
  return codeOfRole(route, NOT_FOUND_ROLE) ?? codeOfStatus(route, NOT_FOUND_STATUS);
}

/**
 * The route whose 404 answers a request the contract does not serve: a method a contract path does not serve
 * (OPTIONS included) answers the path's 404 in the api's format when an operation of the path declares one; a path
 * under the api's base path that no route serves exactly answers the api's `notFound` code, never a domain 404 of
 * one operation. Undefined when no operation can answer it: the reply is then a bare 404 with no body.
 */
export function notServedRoute(api: ContractApi, path: string): ContractRoute | undefined {
  return matchesContractPath(api, path)
    ? api.routes.find(
        (candidate) =>
          notFoundCodeOf(candidate) !== undefined &&
          matchesContractPath({ ...api, routes: [candidate] }, path),
      )
    : api.routes.find((candidate) => codeOfRole(candidate, NOT_FOUND_ROLE) !== undefined);
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
 * A framework refusal (an error carrying a 401, 403 or 429 status) mapped as `statusError` maps it. Undefined for any
 * other error.
 */
export function frameworkRefusal(route: ContractRoute, error: unknown): ContractError | undefined {
  const status = errorStatus(error);

  if (status !== UNAUTHORIZED && status !== FORBIDDEN && status !== TOO_MANY_REQUESTS) {
    return undefined;
  }

  return statusError(route, status, error, FRAMEWORK_REFUSAL_FIXES);
}

/** Whether the operation answers a status: a code of the status's role, or a code of that status. */
export function declaresStatus(route: ContractRoute, status: number): boolean {
  return statusRoleCode(route, status) !== undefined || codeOfStatus(route, status) !== undefined;
}

/**
 * An HTTP status thrown on an operation, as its code: the code of the status's role first, else the operation's one
 * code of that status when it requires no params, else a 500 whose cause names the fix.
 */
export function statusError(
  route: ContractRoute,
  status: number,
  cause: unknown,
  fixes: StatusErrorFixes,
): ContractError {
  const roleCode = statusRoleCode(route, status);

  if (roleCode !== undefined) return new ContractError(roleCode);

  const [entry, ...otherEntries] = Object.values(route.errors).filter(
    (candidate) => candidate.status === status,
  );

  if (entry === undefined) return unexpectedError(route, cause);

  if (otherEntries.length > 0) {
    const codes = [entry, ...otherEntries].map((candidate) => candidate.code).join(", ");

    return unexpectedError(
      route,
      new Error(
        `seampact: a ${status} error on '${route.id}' matches its codes ${codes}; ${fixes.severalCodes}.`,
      ),
    );
  }

  if (entry.requiresParams === true) {
    return unexpectedError(
      route,
      new Error(
        `seampact: a ${status} error on '${route.id}' maps to '${entry.code}', which declares required params; ${fixes.requiredParams}.`,
      ),
    );
  }

  return new ContractError(entry.code);
}

function statusRoleCode(route: ContractRoute, status: number): string | undefined {
  const role = STATUS_ROLES[status];

  return role === undefined ? undefined : codeOfRole(route, role);
}

/** A client error a body read raises, as the operation's code of its status; a 500 when it declares none. */
export function clientStatusError(
  route: ContractRoute,
  status: number,
  exception: unknown,
): ContractError {
  const code = codeOfStatus(route, status);

  return code === undefined ? unexpectedError(route, exception) : new ContractError(code);
}

/** Logs a failure of a reply the boundary writes outside a framework's error path; nothing else can answer it. */
export function logWriteFailure(api: ContractApi, error: unknown): void {
  runtimeLog.error(`seampact: writing a reply of api '${api.id}' failed`, error);
}
