// The hooks an app registers for one api, the wrapper around every hook call (ADR 0012 "Failures inside hooks"),
// and the hook part of the boot check.
import type {
  AuthenticateHook,
  AuthenticateRequest,
  DecideHook,
  ErrorCodeWithParams,
  IdempotencyStore,
  RequirementRequest,
  ResolvedScope,
  ResolveScopeHook,
  ResolveScopeRequest,
} from "@seampact/hooks";
import { ContractError, unexpectedError } from "./contract-error.js";
import type { ContractApi, ContractRoute } from "./contract-route.js";
import { runtimeLog, runtimeLogOf } from "./runtime-logger.js";

export type AnyAuthenticateHook = AuthenticateHook<
  AuthenticateRequest<object, object>,
  unknown,
  ErrorCodeWithParams
>;

export type AnyDecideHook = DecideHook<RequirementRequest>;

export type AnyResolveScopeHook = ResolveScopeHook<
  ResolveScopeRequest,
  ResolvedScope,
  ErrorCodeWithParams
>;

/** A decider and the right and rule names it claims, or every name. */
export interface DeciderRegistration<Names extends string = string, Hook = AnyDecideHook> {
  readonly names: readonly Names[] | "all";
  readonly decider: Hook;
}

/** What the app passes to `onUnexpectedError`, besides the exception or the violating reply. */
export interface UnexpectedErrorContext {
  readonly api: string;
  readonly operation: string | undefined;
  readonly method: string;
  readonly path: string;
}

export type UnexpectedErrorHook = (
  exceptionOrReply: unknown,
  context: UnexpectedErrorContext,
) => void | Promise<void>;

/** The hooks of one api as the boundary calls them; the generated `SeampactHooks` type narrows each member. */
export interface BoundaryHooks {
  readonly authenticate: Readonly<Record<string, AnyAuthenticateHook>>;
  readonly deciders: readonly DeciderRegistration[];
  readonly scopeResolvers: Readonly<Record<string, AnyResolveScopeHook>>;
  readonly idempotencyStore?: IdempotencyStore;
  readonly onUnexpectedError?: UnexpectedErrorHook;
}

/** What an app registers: every member optional, as an api with only public operations asks for none. */
export type RegisteredHooks = Partial<BoundaryHooks>;

/** The `hooks` option's type: required unless an app can register none (every member of `Hooks` optional). */
export type HooksRequirement<Hooks> =
  Partial<Hooks> extends Hooks ? unknown : { readonly hooks: Hooks };

/** The arguments of a call that registers hooks: none when an app can register none. */
export type HooksArgument<Hooks> = Partial<Hooks> extends Hooks ? [hooks?: Hooks] : [hooks: Hooks];

/** The hooks an app registered, with each missing member empty; the boot check then names what a route lacks. */
export function resolvedHooks(registered: RegisteredHooks | undefined): BoundaryHooks {
  return {
    ...registered,
    authenticate: registered?.authenticate ?? {},
    deciders: registered?.deciders ?? [],
    scopeResolvers: registered?.scopeResolvers ?? {},
  };
}

/** How the framework placement recognizes its own denial exceptions thrown inside a decide hook. */
export type FrameworkDenialTest = (error: unknown) => boolean;

/** One hook's answer, or the exception it threw or rejected with. */
export async function callHook<Result>(
  call: () => Result | Promise<Result>,
  failure: {
    readonly route: ContractRoute;
    readonly isFrameworkDenial: FrameworkDenialTest;
    /** The first declared denial code, answered for a framework denial thrown inside a decide hook. */
    readonly denialCode?: string;
  },
): Promise<Result> {
  try {
    return await call();
  } catch (error) {
    if (failure.denialCode !== undefined && failure.isFrameworkDenial(error)) {
      throw new ContractError(failure.denialCode);
    }

    throw unexpectedError(failure.route, error);
  }
}

/** The decider registered for a right or rule name: the one claiming it by name, else the one claiming all. */
export function deciderFor(hooks: BoundaryHooks, name: string): AnyDecideHook | undefined {
  const named = hooks.deciders.find(
    (registration) => registration.names !== "all" && registration.names.includes(name),
  );

  return (named ?? hooks.deciders.find((registration) => registration.names === "all"))?.decider;
}

/** Calls `onUnexpectedError`; a failure inside it is logged, never raised. */
export async function reportUnexpected(
  hooks: BoundaryHooks | undefined,
  exceptionOrReply: unknown,
  context: UnexpectedErrorContext,
): Promise<void> {
  const hook = hooks?.onUnexpectedError;

  if (hook === undefined) return;

  try {
    await hook(exceptionOrReply, context);
  } catch (error) {
    runtimeLog.error(
      `seampact: onUnexpectedError failed for operation '${context.operation ?? "(none)"}' of api '${context.api}'`,
      error,
    );
  }
}

/** A problem the boot check reports: the operation, what is missing, and the fix. */
export interface BootProblem {
  readonly operation?: string;
  readonly problem: string;
  readonly fix: string;
}

/** The part of an api the hook boot check reads. */
export interface HookCheckedApi {
  readonly id: string;
  readonly hookCheck: ContractApi["hookCheck"];
  readonly routes: readonly HookCheckedRoute[];
}

interface HookCheckedRoute {
  readonly id: string;
  readonly access:
    | { readonly kind: "public" }
    | { readonly kind: "identity"; readonly identity: string };
  readonly requires: readonly { readonly name: string }[];
  readonly fieldRights: readonly { readonly right: string }[];
  readonly scopes: readonly { readonly scope: string }[];
  readonly idempotency?: unknown;
}

/**
 * The problems that stop the boot, by the api's `hookCheck`. A doubly claimed right is refused at every level, as
 * which decider authorizes it would depend on registration order. A missing hook stops the boot at `error`; at `warn`
 * it is logged and at `off` ignored, and a route whose hook is missing then answers the derived unexpected-error reply.
 */
export function enforcedHookBootProblems(api: HookCheckedApi, hooks: BoundaryHooks): BootProblem[] {
  const claims = withoutRepeatedProblems(duplicateClaims(hooks));

  if (api.hookCheck === "off") return claims;

  const missing = missingHookProblems(api, hooks);

  if (api.hookCheck === "error") return [...claims, ...missing];

  if (missing.length > 0) {
    runtimeLogOf(api).warn(bootProblemsMessage(api, missing, HOOKS_WARN_HEADING));
  }

  return claims;
}

const HOOKS_WARN_HEADING =
  "starts with hooks missing ('artefacts.bootCheck.hooks: warn'); the routes that need them answer 500:";

function missingHookProblems(api: HookCheckedApi, hooks: BoundaryHooks): BootProblem[] {
  const problems: BootProblem[] = [];

  for (const route of api.routes) {
    if (
      route.access.kind === "identity" &&
      !Object.hasOwn(hooks.authenticate, route.access.identity)
    ) {
      problems.push({
        operation: route.id,
        problem: `no authenticate hook for the identity '${route.access.identity}'`,
        fix: `register one under 'authenticate.${route.access.identity}'`,
      });
    }

    for (const name of requirementNames(route)) {
      if (deciderFor(hooks, name) === undefined) {
        problems.push({
          operation: route.id,
          problem: `no decider for '${name}'`,
          fix: `register a decider whose 'names' list '${name}', or one with names 'all'`,
        });
      }
    }

    for (const scope of route.scopes) {
      if (!Object.hasOwn(hooks.scopeResolvers, scope.scope)) {
        problems.push({
          operation: route.id,
          problem: `no scope resolver for the scope '${scope.scope}'`,
          fix: `register one under 'scopeResolvers.${scope.scope}'`,
        });
      }
    }

    if (route.idempotency !== undefined && hooks.idempotencyStore === undefined) {
      problems.push({
        operation: route.id,
        problem: "no idempotency store for an idempotent operation",
        fix: "register 'idempotencyStore', such as createMemoryIdempotencyStore() of @seampact/idempotency-memory",
      });
    }
  }

  return withoutRepeatedProblems(problems);
}

function requirementNames(route: HookCheckedRoute): string[] {
  return [
    ...route.requires.map((requirement) => requirement.name),
    ...route.fieldRights.map((fieldRight) => fieldRight.right),
  ];
}

function duplicateClaims(hooks: BoundaryHooks): BootProblem[] {
  const claimed = new Set<string>();
  const problems: BootProblem[] = [];
  let allClaims = 0;

  for (const registration of hooks.deciders) {
    if (registration.names === "all") {
      allClaims += 1;
      continue;
    }

    for (const name of registration.names) {
      if (claimed.has(name)) {
        problems.push({
          problem: `two deciders claim '${name}'`,
          fix: `keep '${name}' in one decider's 'names'`,
        });
      }

      claimed.add(name);
    }
  }

  if (allClaims > 1) {
    problems.push({
      problem: "two deciders claim every name ('all')",
      fix: "keep 'all' on one decider at most",
    });
  }

  return problems;
}

function withoutRepeatedProblems(problems: readonly BootProblem[]): BootProblem[] {
  const seen = new Set<string>();

  return problems.filter((problem) => {
    const key = `${problem.operation ?? ""}\n${problem.problem}`;

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}

/** The boot check's message: every problem with its operation and fix. */
export function bootProblemsMessage(
  api: Pick<ContractApi, "id">,
  problems: readonly BootProblem[],
  heading = "cannot start:",
): string {
  const lines = problems.map(
    (problem) =>
      `- ${problem.operation === undefined ? "" : `operation '${problem.operation}': `}${problem.problem}; fix: ${problem.fix}.`,
  );

  return `seampact: the api '${api.id}' ${heading}\n${lines.join("\n")}`;
}
