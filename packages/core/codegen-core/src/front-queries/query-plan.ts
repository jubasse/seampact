import type { ContractIR, Operation } from "@seampact/spec/ir";
import { deriveName } from "@seampact/spec/naming";
import type { ClientDescriptor } from "../descriptors.js";
import type { GenerateWarning } from "../generate-warning.js";
import { below, type IrLocation, operationLocation } from "../ir-location.js";
import { refuseInconsistentIr } from "../located-refusals.js";
import { typeScriptIdentifier } from "../planned-names.js";
import type { Refusal } from "../refusal.js";
import { type NextPageRule, nextPageRuleOf } from "./next-page-rule.js";

// The framework-neutral query plan of one api (ADR 0021 "The shared query plan and front runtime"): per operation,
// its form, the names of its exports, its key and resource, the call options it needs and its next-page rule. Every
// front renderer reads it, so the keys, the invalidation and the paging agree across frameworks.

/** A `safe` operation is read through a query, any other through a mutation. */
export type QueryForm = "query" | "mutation";

/** The names one operation adds to the factory's result and to `keys`. */
export interface QueryNames {
  // The operation's base name (ADR 0007), the client method's.
  readonly base: string;
  // `<base>Options` for a query, `<base>MutationOptions` for a mutation.
  readonly options: string;
  // `use<Base>`.
  readonly hook: string;
  // Present when the operation has an infinite query.
  readonly infinite?: {
    readonly options: string;
    readonly hook: string;
    readonly key: string;
  };
}

export interface QueryOperation {
  readonly operationId: string;
  readonly form: QueryForm;
  readonly names: QueryNames;
  // The resource type a query's key sits under and a mutation invalidates.
  readonly resource?: string;
  // The request headers the client fills itself (idempotency, deadline), by lower-case key: never in a key.
  readonly filledHeaderKeys: readonly string[];
  // The client method requires `timeoutMs` in its call options.
  readonly needsTimeout: boolean;
  // The request header key of the operation's idempotency key, when it has one.
  readonly idempotencyHeaderKey?: string;
  // The `staleTime` under `staleTime: contract`: the contract's `max-age`, 0 when it is not stored.
  readonly freshnessMs: number;
  readonly nextPage?: NextPageRule;
}

export interface QueryPlan {
  // The api's PascalCase name, as in `create<Api>Queries`.
  readonly apiName: string;
  readonly operations: readonly QueryOperation[];
  // The resource types of the api's operations, sorted.
  readonly resources: readonly string[];
}

export interface QueryPlanSettings {
  // Plan an infinite query for each paged query whose style allows one.
  readonly infinite: boolean;
}

export type QueryPlanOutcome =
  | { readonly status: "planned"; readonly plan: QueryPlan; readonly warnings: GenerateWarning[] }
  | { readonly status: "refused"; readonly refusals: Refusal[] };

const OPTIONS_SUFFIX = "Options";
const MUTATION_OPTIONS_SUFFIX = "MutationOptions";
const INFINITE_SUFFIX = "Infinite";
const HOOK_PREFIX = "use";
const FACTORY_MEMBER_KEYS = "keys";
const KEY_MEMBERS = ["all", "resource"];
const API_NAME_ROLE = "schema";
const NOT_STORED_MS = 0;

/** The query plan of an api over its linked client, or every refusal at once. */
export function planQueries(
  ir: ContractIR,
  client: ClientDescriptor,
  settings: QueryPlanSettings,
): QueryPlanOutcome {
  const refusals: Refusal[] = [];
  const warnings: GenerateWarning[] = [];
  const factoryMembers = new MemberNames("the factory's result", refusals);
  const keyMembers = new MemberNames("`keys`", refusals);

  factoryMembers.claim(FACTORY_MEMBER_KEYS, undefined);
  KEY_MEMBERS.forEach((member) => {
    keyMembers.claim(member, undefined);
  });

  const operations = ir.operations.flatMap((operation, index) => {
    const location = operationLocation(index, operation.id);
    const clientOperation = Object.hasOwn(client.operations, operation.id)
      ? client.operations[operation.id]
      : undefined;

    if (clientOperation === undefined) {
      refusals.push(
        refuseInconsistentIr(
          "link.client.operation.missing",
          "The client link has no method for this operation",
          location,
        ),
      );

      return [];
    }

    const planned = planOperation(
      ir,
      operation,
      clientOperation.method,
      settings,
      location,
      warnings,
    );

    claimNames(planned, location, factoryMembers, keyMembers);

    return [planned];
  });

  if (refusals.length > 0) return { status: "refused", refusals };

  const resources = [
    ...new Set(operations.flatMap((operation) => operation.resource ?? [])),
  ].sort();

  return {
    status: "planned",
    plan: {
      apiName: typeScriptIdentifier(deriveName(ir.api.name.segments, API_NAME_ROLE)),
      operations,
      resources,
    },
    warnings,
  };
}

function planOperation(
  ir: ContractIR,
  operation: Operation,
  base: string,
  settings: QueryPlanSettings,
  location: IrLocation,
  warnings: GenerateWarning[],
): QueryOperation {
  const form: QueryForm = operation.safe ? "query" : "mutation";
  const nextPage =
    form === "query" && settings.infinite
      ? nextPageOf(ir, operation, location, warnings)
      : undefined;
  const idempotencyHeader =
    operation.idempotency !== undefined && "header" in operation.idempotency
      ? operation.idempotency.header
      : undefined;
  const filledHeaders = [
    ...(idempotencyHeader === undefined ? [] : [idempotencyHeader]),
    ...(operation.deadlineHeader === undefined ? [] : [operation.deadlineHeader]),
  ];

  return {
    operationId: operation.id,
    form,
    names: queryNames(base, form, nextPage !== undefined),
    ...(operation.resource === undefined ? {} : { resource: operation.resource.type }),
    filledHeaderKeys: filledHeaders.map((header) => header.toLowerCase()),
    needsTimeout: operation.deadlineHeader !== undefined && operation.budgetMs === undefined,
    ...(idempotencyHeader === undefined
      ? {}
      : { idempotencyHeaderKey: idempotencyHeader.toLowerCase() }),
    freshnessMs: freshnessOf(operation),
    ...(nextPage === undefined ? {} : { nextPage }),
  };
}

// A paged query whose style gives no next position keeps its plain query, with a warning naming why.
function nextPageOf(
  ir: ContractIR,
  operation: Operation,
  location: IrLocation,
  warnings: GenerateWarning[],
): NextPageRule | undefined {
  if (operation.paging?.style === undefined) return undefined;

  const outcome = nextPageRuleOf(ir, operation);

  if (outcome.status === "ruled") return outcome.rule;

  warnings.push({
    code: "paging.infinite.skipped",
    message: `The operation '${operation.id}' gets no infinite query: ${outcome.reason}; its plain query stays.`,
    fix: "Load the next page with the plain query and the request's position parameter, or give the paging style a next-page fact.",
    operation: operation.id,
    member: below(location, "paging").member,
  });

  return undefined;
}

function queryNames(base: string, form: QueryForm, hasInfinite: boolean): QueryNames {
  const pascal = `${base.charAt(0).toUpperCase()}${base.slice(1)}`;
  const hook = `${HOOK_PREFIX}${pascal}`;

  return {
    base,
    options: `${base}${form === "query" ? OPTIONS_SUFFIX : MUTATION_OPTIONS_SUFFIX}`,
    hook,
    ...(hasInfinite
      ? {
          infinite: {
            options: `${base}${INFINITE_SUFFIX}${OPTIONS_SUFFIX}`,
            hook: `${hook}${INFINITE_SUFFIX}`,
            key: `${base}${INFINITE_SUFFIX}`,
          },
        }
      : {}),
  };
}

// No directives (a `never` family), `no-store` or `no-cache` make every read go to the server.
function freshnessOf(operation: Operation): number {
  const { cache } = operation;

  if (cache === undefined || cache.noStore || cache.directives === undefined) return NOT_STORED_MS;

  return cache.directives.noCache ? NOT_STORED_MS : cache.directives.maxAgeMs;
}

function claimNames(
  operation: QueryOperation,
  location: IrLocation,
  factoryMembers: MemberNames,
  keyMembers: MemberNames,
): void {
  const { names } = operation;

  factoryMembers.claim(names.options, location);
  factoryMembers.claim(names.hook, location);

  if (operation.form === "query") keyMembers.claim(names.base, location);

  if (names.infinite === undefined) return;

  factoryMembers.claim(names.infinite.options, location);
  factoryMembers.claim(names.infinite.hook, location);
  keyMembers.claim(names.infinite.key, location);
}

// The members of one generated object; a second member of one name is refused with both operation ids.
class MemberNames {
  private readonly claimed = new Map<string, IrLocation | undefined>();

  constructor(
    private readonly owner: string,
    private readonly refusals: Refusal[],
  ) {}

  // `location` is the operation the member is for, absent for a member every factory has.
  claim(member: string, location: IrLocation | undefined): void {
    if (!this.claimed.has(member)) {
      this.claimed.set(member, location);

      return;
    }

    const first = this.claimed.get(member)?.operation;
    const firstOwner =
      first === undefined ? "a member every factory has" : `the operation '${first}'`;

    this.refusals.push({
      code: "names.collision",
      message: `The name '${member}' of ${this.owner}, for the operation '${location?.operation ?? ""}', is already the name of ${firstOwner}.`,
      fix: "Rename one of the two operations in the contract so that their generated names differ.",
      member: location?.member ?? "",
      ...(location?.operation === undefined ? {} : { operation: location.operation }),
    });
  }
}
