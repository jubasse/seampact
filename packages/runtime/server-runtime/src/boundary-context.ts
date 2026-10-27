// The request context of a contract route, opened before any check runs and read by the outgoing check of every
// server profile.
import { AsyncLocalStorage } from "node:async_hooks";
import type { AccessGrant, CheckState } from "./access-checks.js";
import type { BoundaryHooks, UnexpectedErrorContext } from "./boundary-hooks.js";
import type { ContractApi, ContractRoute, ResponsesMode } from "./contract-route.js";

/** The state of one contract request, opened before any check runs. */
export interface BoundaryContext {
  readonly api: ContractApi;
  readonly route: ContractRoute;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly hooks: BoundaryHooks;
  readonly bodyValidation: boolean;
  mode: ResponsesMode;
  /** True while the boundary writes its own reply, which skips the contract checks. */
  boundaryWriting: boolean;
  /** NestJS only: true once the handler wrapper took the request, so a contract method the handler calls runs as a
   * plain call. */
  handlerStarted?: boolean;
  /** NestJS only: the request as the guard checked it, for the input pipe and step 10. */
  checkState?: CheckState;
  /** NestJS only: true once steps 6 to 8 checked the input, which the handler and step 10 require. */
  inputChecked?: boolean;
  /** NestJS only: true once the boundary wrote the reply, so a value NestJS's interceptors pass on is not written. */
  replyWritten?: boolean;
  idempotencyKey?: string;
  grant?: AccessGrant;
  input?: unknown;
  /** An exception no seampact filter claims, kept so a violating reply reports it to `onUnexpectedError`. */
  unclaimedException?: unknown;
}

/** The context of the contract request being served, absent outside one. */
export const boundaryContext = new AsyncLocalStorage<BoundaryContext>();

/** The context hooks receive in `onUnexpectedError`. */
export function unexpectedContext(
  context: BoundaryContext,
  method: string,
  path: string,
): UnexpectedErrorContext {
  return { api: context.api.id, operation: context.route.id, method, path };
}
