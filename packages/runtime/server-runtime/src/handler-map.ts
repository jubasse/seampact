// The handler-map registration the Express and Fastify placements share (ADR 0017 and 0018 "Options and
// registration"): the registration options, their boot check, the `responses` and `bodyValidation` settings of one
// operation, and steps 6 to 9 around the bound handler method.
import type { AccessGrant, CheckState } from "./access-checks.js";
import type { BoundaryContext } from "./boundary-context.js";
import type { BootProblem } from "./boundary-hooks.js";
import { type ContractReply, unexpectedError } from "./contract-error.js";
import type { ContractApi, ContractRoute, ResponsesMode } from "./contract-route.js";
import { inputWithAccess } from "./handler-access.js";
import { handlerReply } from "./handler-reply.js";
import { beginIdempotency } from "./idempotency.js";
import { checkRestrictedInput, validateRequestInput } from "./input-checks.js";
import { isPlainObject } from "./plain-object.js";
import { loggerProblems, type RuntimeLogger } from "./runtime-logger.js";

const RESPONSES_MODES: readonly string[] = ["strict", "warn"];

/** What a reply outside the contract does, and whether JSON success bodies are validated. */
export interface ResponseSettings {
  readonly responses: ResponsesMode;
  readonly bodyValidation: boolean;
}

/** One operation's override of the registration's settings. */
export interface OperationSettings {
  readonly responses?: ResponsesMode;
  readonly bodyValidation?: boolean;
}

/** Where an operation's handler lives: the object of its interface in `handlers`, and its method. */
export interface HandlerBinding {
  readonly handlers: string;
  readonly method: string;
}

/** The handler binding of every operation, by operation id; `method` is also the key of its override. */
export type HandlerBindings = Readonly<Record<string, HandlerBinding>>;

/** The registration options of one api: the generated module narrows each type parameter. */
export interface RegistrationOptions<Hooks, Handlers, Operation extends string = string> {
  readonly handlers: Handlers;
  readonly hooks?: Hooks;
  readonly responses?: ResponsesMode;
  readonly bodyValidation?: boolean;
  /** Where the boundary writes its warnings and unexpected failures; the console when absent. */
  readonly logger?: RuntimeLogger;
  readonly operations?: Partial<Readonly<Record<Operation, OperationSettings>>>;
}

/** Every problem of the registration options, listed with the hook problems at boot. */
export function registrationProblems(
  api: ContractApi,
  bindings: HandlerBindings,
  options: RegistrationOptions<unknown, unknown>,
  generated: ResponseSettings,
): BootProblem[] {
  const problems: BootProblem[] = [
    ...settingsProblems(options, "the registration"),
    ...handlerProblems(api, bindings, options.handlers),
    ...loggerProblems(options.logger),
  ];
  const overrideKeys = new Set(Object.values(bindings).map((binding) => binding.method));
  const operations: unknown = options.operations ?? {};

  if (!isPlainObject(operations)) {
    problems.push({
      problem: "'operations' is not an object",
      fix: "pass 'operations' as an object keyed by operation, or leave it out",
    });

    return problems;
  }

  for (const [key, override] of Object.entries(operations)) {
    if (!overrideKeys.has(key)) {
      problems.push({
        problem: `'operations' names '${key}', which is no operation of the api`,
        fix: `use one of ${[...overrideKeys].join(", ")}`,
      });

      continue;
    }

    problems.push(...settingsProblems(override, `the override of '${key}'`));
  }

  if (
    !generated.bodyValidation &&
    api.routes.some((route) => settingsOf(route, bindings, options, generated).bodyValidation)
  ) {
    problems.push({
      problem: "'bodyValidation' is turned on, but the target generated no output validators",
      fix: "set 'bodyValidation: true' in the target's options and generate again",
    });
  }

  return problems;
}

/** The operation's settings: its override, else the registration's, else the target options'. */
export function settingsOf(
  route: ContractRoute,
  bindings: HandlerBindings,
  options: RegistrationOptions<unknown, unknown>,
  generated: ResponseSettings,
): ResponseSettings {
  const key = bindings[route.id]?.method;
  const override =
    key === undefined || options.operations === undefined
      ? undefined
      : Object.entries(options.operations).find(([name]) => name === key)?.[1];

  return {
    responses: override?.responses ?? options.responses ?? generated.responses,
    bodyValidation: override?.bodyValidation ?? options.bodyValidation ?? generated.bodyValidation,
  };
}

function settingsProblems(settings: unknown, owner: string): BootProblem[] {
  if (!isPlainObject(settings)) {
    return [
      {
        problem: `${owner} is not an object`,
        fix: "pass an object with 'responses' or 'bodyValidation'",
      },
    ];
  }

  const problems: BootProblem[] = [];
  const { responses, bodyValidation } = settings;

  if (
    responses !== undefined &&
    (typeof responses !== "string" || !RESPONSES_MODES.includes(responses))
  ) {
    problems.push({
      problem: `'responses' of ${owner} is ${JSON.stringify(responses)}`,
      fix: "set it to 'strict' or 'warn', or leave it out",
    });
  }

  if (bodyValidation !== undefined && typeof bodyValidation !== "boolean") {
    problems.push({
      problem: `'bodyValidation' of ${owner} is ${JSON.stringify(bodyValidation)}`,
      fix: "set it to true or false, or leave it out",
    });
  }

  return problems;
}

function handlerProblems(
  api: ContractApi,
  bindings: HandlerBindings,
  handlers: unknown,
): BootProblem[] {
  if (typeof handlers !== "object" || handlers === null) {
    return [
      {
        problem: "'handlers' is not an object",
        fix: "pass one handler object per generated interface",
      },
    ];
  }

  const problems: BootProblem[] = [];

  for (const route of api.routes) {
    const binding = bindings[route.id];

    if (binding === undefined) {
      problems.push({
        operation: route.id,
        problem: "the generated module binds no handler",
        fix: "generate the api again",
      });

      continue;
    }

    const owner: unknown = Reflect.get(handlers, binding.handlers);

    if (typeof owner !== "object" || owner === null) {
      problems.push({
        operation: route.id,
        problem: `'handlers' has no '${binding.handlers}' object`,
        fix: `pass an object implementing ${binding.handlers} as handlers.${binding.handlers}`,
      });

      continue;
    }

    if (typeof Reflect.get(owner, binding.method) !== "function") {
      problems.push({
        operation: route.id,
        problem: `handlers.${binding.handlers} has no method ${binding.method}()`,
        fix: `implement ${binding.method}() on the ${binding.handlers} object`,
      });
    }
  }

  return problems;
}

/**
 * Steps 6 to 8 and the idempotency claim: stores the validated input on the context, and answers the stored
 * reply of a replay, undefined when the handler runs.
 */
export async function runInputSteps(
  state: CheckState,
  context: BoundaryContext,
): Promise<{ readonly replay: ContractReply } | undefined> {
  const grant = requireGrant(context);
  const validated = await validateRequestInput(state, grant);
  const input = await checkRestrictedInput(state, grant, validated);

  context.input = input;

  const started = await beginIdempotency(state, grant, input);

  if (started?.outcome === "replay") return { replay: started.reply };

  if (started?.outcome === "started") context.idempotencyKey = started.key;

  return undefined;
}

/** Step 9: calls the bound method on its object, so a class instance keeps its `this`; answers the reply to write. */
export async function handlerResultReply(
  state: CheckState,
  context: BoundaryContext,
  handlers: unknown,
  binding: HandlerBinding,
): Promise<ContractReply> {
  const owner: unknown =
    typeof handlers === "object" && handlers !== null
      ? Reflect.get(handlers, binding.handlers)
      : undefined;
  const method: unknown =
    typeof owner === "object" && owner !== null ? Reflect.get(owner, binding.method) : undefined;

  if (typeof method !== "function") {
    throw unexpectedError(
      context.route,
      new Error(`seampact: handlers.${binding.handlers}.${binding.method} is not a function`),
    );
  }

  const grant = requireGrant(context);
  const result: unknown = await Reflect.apply(method, owner, [
    inputWithAccess(context.route, grant, context.input),
  ]);

  return handlerReply(state, grant, context.input, result);
}

function requireGrant(context: BoundaryContext): AccessGrant {
  if (context.grant === undefined) {
    throw unexpectedError(context.route, new Error("seampact: the access steps did not run"));
  }

  return context.grant;
}
