// What the release gate does not require in the version it gates (1.1.0): the checklist items it leaves out, each
// with its reason, and the declared deferrals of a suite case a server refuses until a later version. A release
// policy over the checklist, which stays the list of facts.
import {
  INPUT_RULES_CASE_ID,
  inputRulesNotYetRefusal,
} from "../../packages/tools/http-suite/src/input-rules-case.ts";
import type { Item, Problem } from "./model.ts";
import { CONCRETE_TARGETS, expandTargets, SERVER_TARGETS } from "./targets.ts";

export const RELEASE_SCOPE_FILE = "scripts/checklist/release-scope.ts";

/** The version the release gate gates. */
export const GATED_VERSION = "1.1.0";

/** The targets the gate does not require yet, each with its reason: every pair of the target waits. */
export const DEFERRED_TARGETS: ReadonlyMap<string, string> = new Map([
  ["axios", "proofs in the axios step"],
]);

/**
 * A suite case that servers refuse by name until a later version: its refusal no longer turns a profile id refused.
 * The refusal test is the consumer's own suite refusals, which hold the case under the declared reason; the
 * checklist tests import each consumer's refusals and check it.
 */
export interface DeclaredDeferral {
  readonly caseId: string;
  readonly targets: readonly string[];
  /** The reason the report gives the refused case on a target. */
  readonly reasonOn: (target: string) => string;
}

const INPUT_RULES_RELEASE = "1.2.0";

const inputRulesReasonOn = (target: string): string =>
  inputRulesNotYetRefusal(target, INPUT_RULES_RELEASE)[INPUT_RULES_CASE_ID] ?? "";

export const DECLARED_DEFERRALS: readonly DeclaredDeferral[] = [
  {
    caseId: INPUT_RULES_CASE_ID,
    targets: ["spring-boot", "fastapi", "drf", "ninja", "api-platform"],
    reasonOn: inputRulesReasonOn,
  },
];

/** Whether a report's refused case is a declared deferral on [target]: its id and its exact reason. */
export function isDeclaredDeferral(
  deferrals: readonly DeclaredDeferral[],
  caseId: string,
  target: string,
  reason: string | undefined,
): boolean {
  return deferrals.some(
    (deferral) =>
      deferral.caseId === caseId &&
      deferral.targets.includes(target) &&
      deferral.reasonOn(target) === reason,
  );
}

/** Each declared deferral on a target that is no server. */
export function declaredDeferralProblems(deferrals: readonly DeclaredDeferral[]): Problem[] {
  return deferrals.flatMap((deferral) =>
    deferral.targets
      .filter((target) => !SERVER_TARGETS.includes(target))
      .map((target) => ({
        file: RELEASE_SCOPE_FILE,
        message: `declared deferral of ${deferral.caseId} on ${target}, not a server target`,
      })),
  );
}

/** An item the gate does not require: on the targets named, or on all its targets without `targets`. */
export interface ItemDeferred {
  readonly targets?: readonly string[];
  readonly reason: string;
  /** Targets on which generation refuses the form by name; each needs a refusal test in a proof file. */
  readonly refusedOn?: readonly string[];
}

const SCALE_CAPACITY =
  "generated code at scale: no behaviour a fix would change; scripts/golden/scale.test.ts proves the core pair";

const ADAPTERS: readonly string[] = ["nestjs-casl", "laravel-spatie"];
const ADAPTERS_IN_1_1 = "the CASL and spatie adapters ship in 1.1 (A24 amended)";
const VALIDATORS: readonly string[] = ["zod", "yup", "class-validator"];
const UNKNOWN_KEYS_POLICIES =
  "1.0 refuses the unknown keys policies ignore and keep of an operation input by name at generation, on the validators targets";

// The servers whose refusals of the forms below are tested; API Platform and Next.js join them with their proofs.
const SERVERS_WITHOUT_TESTED_REFUSALS: readonly string[] = ["api-platform", "nextjs"];

export const SERVERS_WITH_TESTED_REFUSALS: readonly string[] = SERVER_TARGETS.filter(
  (target) => !SERVERS_WITHOUT_TESTED_REFUSALS.includes(target),
);

const NODE_SERVERS: readonly string[] = ["nestjs", "fastify", "express", "adonis", "hono"];

const PYTHON_SERVERS: readonly string[] = ["fastapi", "drf", "ninja"];

const PHP_AND_PYTHON_SERVERS: readonly string[] = ["laravel", "symfony", ...PYTHON_SERVERS];

const VARIANTS_FORM =
  "a principal with variants (viewer_or_device) and, on the Node servers, optional authentication";

// The servers whose generators read the IR without Node: the JVM and PHP targets.
const JVM_AND_PHP_SERVERS: readonly string[] = ["spring-boot", "laravel", "symfony"];

// The targets whose generators refuse the body and query forms below by name, each with a refusal test.
const BODY_AND_QUERY_FORMS_REFUSED_ON: readonly string[] = [
  "fetch",
  ...NODE_SERVERS,
  ...JVM_AND_PHP_SERVERS,
  ...PYTHON_SERVERS,
];

const refusedForm = (form: string, targets: readonly string[]): ItemDeferred => ({
  targets,
  refusedOn: targets,
  reason: `1.0 refuses ${form} by name at generation on ${targets.join(", ")}`,
});

const refusedOnEveryServer = (form: string): ItemDeferred => ({
  targets: SERVERS_WITH_TESTED_REFUSALS,
  refusedOn: SERVERS_WITH_TESTED_REFUSALS,
  reason: `1.0 refuses ${form} by name at generation`,
});

const refusedOnTheNodeServers = (form: string): ItemDeferred => ({
  targets: NODE_SERVERS,
  refusedOn: NODE_SERVERS,
  reason: `1.0 refuses ${form} by name at generation on the Node servers`,
});

// A response form every server and the clients named refuse by name.
const refusedOnEveryServerAndClient = (form: string, clients: readonly string[]): ItemDeferred => ({
  targets: [...SERVERS_WITH_TESTED_REFUSALS, ...clients],
  refusedOn: [...SERVERS_WITH_TESTED_REFUSALS, ...clients],
  reason: `1.0 refuses ${form} by name at generation on every server and in ${clients.join(" and ")}`,
});

/** The deferred list from its entries; an id listed twice is refused by name, as a Map would keep the last one. */
export function indexItemsDeferred(
  entries: readonly (readonly [string, ItemDeferred])[],
): ReadonlyMap<string, ItemDeferred> {
  const index = new Map<string, ItemDeferred>();

  for (const [id, deferred] of entries) {
    if (index.has(id)) throw new Error(`release-scope.ts lists ${id} twice; merge its entries.`);

    index.set(id, deferred);
  }

  return index;
}

export const ITEMS_DEFERRED: ReadonlyMap<string, ItemDeferred> = indexItemsDeferred([
  ["CHK-001", { targets: ["fetch", "nestjs"], reason: SCALE_CAPACITY }],
  ["CHK-002", { targets: ["fetch", "nestjs"], reason: SCALE_CAPACITY }],
  ["CHK-003", { targets: ["fetch"], reason: SCALE_CAPACITY }],
  ["CHK-004", refusedOnEveryServer(VARIANTS_FORM)],
  ["CHK-006", refusedOnEveryServer(VARIANTS_FORM)],
  [
    "CHK-013",
    {
      refusedOn: ["fetch", ...NODE_SERVERS, ...JVM_AND_PHP_SERVERS, ...PYTHON_SERVERS],
      reason:
        "1.0 refuses the rights-version response header by name at generation: the fetch client as a response header it does not read, and every server (the Node servers, Spring, Laravel, Symfony, FastAPI, DRF, Ninja) as identity.response.header.unsupported, since no handler can write a response header; writing and comparing it at the boundary comes after 1.0",
    },
  ],
  ["CHK-019", refusedOnEveryServer("a principal requirement")],
  ["CHK-033", refusedOnEveryServer("a sort key restricted by a right")],
  ["CHK-187", refusedOnEveryServer("an input field right below the top level of the input")],
  [
    "CHK-130",
    refusedOnTheNodeServers(
      "absolute URLs; the native servers write them from the configured public origin",
    ),
  ],
  [
    "CHK-129",
    refusedOnEveryServer(
      "a page or an item that writes the `$collection`, `$resource` or item id slots (JSON:API, HAL, JSON-LD)",
    ),
  ],
  ["CHK-131", refusedOnEveryServer("a signature scheme verified by the application")],
  ["CHK-132", refusedOnEveryServer("query API key and HTTP Basic schemes")],
  ["CHK-133", refusedOnTheNodeServers("optional authentication; the native servers generate it")],
  ["CHK-128", refusedOnTheNodeServers("the split sort style")],
  [
    "CHK-189",
    {
      targets: SERVERS_WITH_TESTED_REFUSALS,
      refusedOn: NODE_SERVERS,
      reason:
        "1.0 refuses `idempotency.enforce: none` by name at generation on the Node servers; Spring Boot, Laravel, Symfony, FastAPI, DRF and Ninja generate it, not covered by the 1.0 suite",
    },
  ],
  [
    "CHK-032",
    refusedForm("the complete page fact of a changes-since style", PHP_AND_PYTHON_SERVERS),
  ],
  ["CHK-020", refusedOnEveryServer("a principal binding")],
  ["CHK-094", refusedOnEveryServer("a scope resolved by the application")],
  [
    "CHK-188",
    refusedOnEveryServer(
      "a scope id read from a query, header, host or subdomain, or principal-field source",
    ),
  ],
  ["CHK-150", refusedForm("a form body", BODY_AND_QUERY_FORMS_REFUSED_ON)],
  ["CHK-151", refusedForm("a multipart body", BODY_AND_QUERY_FORMS_REFUSED_ON)],
  ["CHK-152", refusedForm("a file download", BODY_AND_QUERY_FORMS_REFUSED_ON)],
  ["CHK-160", refusedForm("a query list in brackets form", BODY_AND_QUERY_FORMS_REFUSED_ON)],
  ["CHK-163", refusedOnEveryServer("native access (accessHooks: false)")],
  ...["CHK-074", "CHK-077", "CHK-078", "CHK-103"].map((id): [string, ItemDeferred] => [
    id,
    { targets: ADAPTERS, reason: ADAPTERS_IN_1_1 },
  ]),
  ["CHK-096", { targets: ["nestjs-casl"], reason: ADAPTERS_IN_1_1 }],
  ["CHK-097", { targets: ["laravel-spatie"], reason: ADAPTERS_IN_1_1 }],
  [
    "CHK-048",
    {
      targets: ["fetch"],
      refusedOn: ["fetch"],
      reason:
        "1.0 refuses an open enum's fallback by name at generation, in the types the fetch client is generated beside",
    },
  ],
  [
    "CHK-125",
    {
      targets: ["fetch"],
      reason:
        "the generated fetch client carries no retry rule taken from the base nature of a code; the front targets retry a rejection and never a declared error, so a rule by nature is additive",
    },
  ],
  [
    "CHK-126",
    {
      targets: ["fetch"],
      refusedOn: ["fetch"],
      reason:
        "1.0 refuses an error format that writes the code only inside a text template by name at generation, so the client does not recover a code from a template",
    },
  ],
  ["CHK-134", { targets: VALIDATORS, refusedOn: VALIDATORS, reason: UNKNOWN_KEYS_POLICIES }],
  ["CHK-135", { targets: VALIDATORS, refusedOn: VALIDATORS, reason: UNKNOWN_KEYS_POLICIES }],
  [
    "CHK-169",
    {
      targets: ["angular"],
      reason:
        "the generated Angular service does not configure HttpClient's XSRF header; the app sets withXsrfConfiguration to the contract's CSRF header, as the angular guide says, and generating it is additive",
    },
  ],
  [
    "CHK-060",
    {
      targets: [...NODE_SERVERS, ...JVM_AND_PHP_SERVERS, ...PYTHON_SERVERS],
      reason:
        "the Node, JVM, PHP and Python servers generate no test helper: an additive artefact a later release can add",
    },
  ],
  [
    "CHK-066",
    {
      targets: [...JVM_AND_PHP_SERVERS, ...PYTHON_SERVERS],
      reason:
        "the JVM and PHP servers ship the IdempotencyStore interface and the Python servers the IdempotencyStore protocol, but no reference store: an additive package a later release can add",
    },
  ],
  [
    "CHK-068",
    {
      targets: [...NODE_SERVERS, ...JVM_AND_PHP_SERVERS, ...PYTHON_SERVERS],
      reason:
        "the Node, JVM, PHP and Python servers serve no dev docs: an additive artefact a later release can add",
    },
  ],
  [
    "CHK-162",
    {
      targets: ["express", "fastify", "hono", "fastapi"],
      reason:
        "express, fastify, hono and fastapi generate no native access export, and express, fastify and hono map no framework security refusals, since those frameworks ship none of their own and the app's middleware owns them: additive artefacts a later release can add",
    },
  ],
  [
    "CHK-090",
    {
      targets: ["nestjs", "laravel"],
      refusedOn: ["nestjs", "laravel"],
      reason: "1.0 refuses a right's custom metadata by name at generation on NestJS and Laravel",
    },
  ],
  [
    "CHK-146",
    {
      targets: ["spring-boot", "laravel", "nestjs"],
      refusedOn: ["spring-boot", "laravel", "nestjs"],
      reason:
        "1.0 refuses the suffixes option and handlers perOperation by name at generation, and NestJS also refuses codeName; Spring Boot and Laravel serve codeName",
    },
  ],
  [
    "CHK-072",
    { reason: "internal installs before publication (A3), gone once the packages are published" },
  ],
  [
    "CHK-088",
    {
      reason:
        "internal PHP packaging, covered by the PHP split job that installs each mirror alone",
    },
  ],
  [
    "CHK-102",
    {
      reason:
        "covered by the per-platform binary smoke the release workflow runs before publishing",
    },
  ],
  [
    "CHK-121",
    { reason: "compile --strict on this lint rule is additive: a later release can turn it on" },
  ],
  ["CHK-122", { reason: "editor tooling, no effect on the IR or the wire" }],
  ["CHK-123", { reason: "text for humans, no effect on the IR or the wire" }],
  ["CHK-143", { reason: "tooling, no effect on the IR" }],
  [
    "CHK-144",
    { reason: "opt-in code style options (A36); the stability of the default output is CHK-103" },
  ],
  ["CHK-148", { reason: "opt-in vendored hooks (A40), off by default" }],
  ["CHK-165", { reason: "opt-in nativeDocs artefact (A43), off by default" }],
  ["CHK-176", { reason: "internal fixture completeness; the classification itself is CHK-175" }],
  [
    "CHK-022",
    refusedOnEveryServerAndClient("a response header the route writes itself", ["fetch"]),
  ],
  ["CHK-024", refusedOnEveryServerAndClient("a tagged union", ["zod", "fetch"])],
  ["CHK-027", refusedOnEveryServerAndClient("a degradable operation", ["fetch"])],
  [
    "CHK-058",
    {
      targets: ["fetch"],
      refusedOn: ["fetch"],
      reason: "1.0 refuses a deprecated operation by name at generation in the fetch client",
    },
  ],
  ["CHK-153", refusedOnEveryServerAndClient("a redirect response", ["fetch"])],
]);

/** Whether the gate leaves the pair of [id] and [target] out of its scope. */
export function isDeferredPair(
  itemsDeferred: ReadonlyMap<string, ItemDeferred>,
  id: string,
  target: string,
): boolean {
  if (DEFERRED_TARGETS.has(target)) return true;

  const deferred = itemsDeferred.get(id);

  return deferred !== undefined && (deferred.targets?.includes(target) ?? true);
}

/** The targets of an item the release gate requires: its concrete targets without its deferred pairs. */
export function releaseGateTargets(
  item: Item,
  itemsDeferred: ReadonlyMap<string, ItemDeferred>,
): string[] {
  return expandTargets(item.targets).filter(
    (target) => !isDeferredPair(itemsDeferred, item.id, target),
  );
}

/**
 * Each entry of the deferred list that no longer holds: an unknown or retired id, a target the item does not list,
 * an empty reason, a pair that [proven] says a proof or a suite report now proves, or a refusal that [refusalProven]
 * says no proof file tests.
 */
export function releaseScopeProblems(
  items: readonly Item[],
  itemsDeferred: ReadonlyMap<string, ItemDeferred>,
  proven: (id: string, target: string) => boolean,
  refusalProven: (id: string, target: string) => boolean,
  deferredTargets: ReadonlyMap<string, string> = DEFERRED_TARGETS,
): Problem[] {
  const problems: Problem[] = deferredTargetProblems(deferredTargets);
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const [id, deferred] of itemsDeferred) {
    const at = (message: string) => problems.push({ file: RELEASE_SCOPE_FILE, id, message });
    const item = byId.get(id);

    if (item === undefined) {
      at("deferred list names an unknown id (not in the checklist)");
      continue;
    }

    if (item.retired !== undefined) {
      at(`deferred list names a retired id (retired: ${item.retired})`);
      continue;
    }

    if (deferred.reason.trim() === "") at("deferred entry without a reason");

    const listed = expandTargets(item.targets);

    for (const target of deferred.targets ?? []) {
      if (!listed.includes(target))
        at(`deferred entry names a target the item does not list: ${target}`);
    }

    for (const target of deferred.targets ?? listed) {
      if (listed.includes(target) && proven(id, target))
        at(`proven for target ${target}: drop it from the deferred list`);
    }

    for (const message of refusalProblems(id, deferred, listed, refusalProven)) at(message);
  }

  return problems;
}

/** Each deferred target that is not a known target or has no reason. */
function deferredTargetProblems(deferredTargets: ReadonlyMap<string, string>): Problem[] {
  return [...deferredTargets].flatMap(([target, reason]) => {
    const at = (message: string) => ({ file: RELEASE_SCOPE_FILE, message });

    return [
      ...(CONCRETE_TARGETS.includes(target) ? [] : [at(`deferred target is unknown: ${target}`)]),
      ...(reason.trim() === "" ? [at(`deferred target ${target} without a reason`)] : []),
    ];
  });
}

/** The refusal named by [deferred] on a target it does not defer or that no proof file tests. */
function refusalProblems(
  id: string,
  deferred: ItemDeferred,
  listed: readonly string[],
  refusalProven: (id: string, target: string) => boolean,
): string[] {
  return (deferred.refusedOn ?? []).flatMap((target) => {
    if (!listed.includes(target) || !(deferred.targets ?? listed).includes(target))
      return [`deferred entry names a refusal on a target it does not defer: ${target}`];

    return refusalProven(id, target)
      ? []
      : [`refused on target ${target} with no refusal test in a proof file`];
  });
}

/** One line per deferred target and per item the gate leaves out, for the gate summary. */
export function itemsDeferredLines(itemsDeferred: ReadonlyMap<string, ItemDeferred>): string[] {
  const targetLines = [...DEFERRED_TARGETS].map(
    ([target, reason]) =>
      `release gate: not required in ${GATED_VERSION}: every id on ${target} (${reason})`,
  );

  return targetLines.concat(
    [...itemsDeferred].map(([id, deferred]) => {
      const scope = deferred.targets === undefined ? "" : ` on ${deferred.targets.join(", ")}`;

      return `release gate: not required in ${GATED_VERSION}: ${id}${scope} (${deferred.reason})`;
    }),
  );
}
