// What the 1.0 release gate does not require: the targets and the checklist items that come after 1.0, each item
// with its reason. A release policy over the checklist, which stays the list of facts.
import type { Item, Problem } from "./model.ts";
import { expandTargets, SERVER_TARGETS } from "./targets.ts";

export const RELEASE_SCOPE_FILE = "scripts/checklist/release-scope.ts";

/** Targets the 1.0 release gate does not require: API Platform comes after v1. */
export const TARGETS_AFTER_1_0: readonly string[] = ["api-platform"];

/** An item the 1.0 gate does not require: on the targets named, or on all its targets without `targets`. */
export interface ItemAfter1_0 {
  readonly targets?: readonly string[];
  readonly reason: string;
  /** Targets on which generation refuses the form by name; each needs a refusal test in a proof file. */
  readonly refusedOn?: readonly string[];
}

const SCALE_CAPACITY =
  "generated code at scale: no behaviour a fix would change; scripts/golden/scale.test.ts proves the core pair";
const API_PLATFORM_AFTER_V1 = "API Platform comes after v1";

const ADAPTERS: readonly string[] = ["nestjs-casl", "laravel-spatie"];
const ADAPTERS_IN_1_1 = "the CASL and spatie adapters ship in 1.1 (A24 amended)";
const VALIDATORS: readonly string[] = ["zod", "yup", "class-validator"];
const UNKNOWN_KEYS_POLICIES =
  "1.0 refuses the unknown keys policies ignore and keep of an operation input by name at generation, on the validators targets";

// The servers the gate requires: every generator refuses the access forms below by name, so each of them is deferred
// with its refusal tested.
export const SERVERS_FOR_1_0: readonly string[] = SERVER_TARGETS.filter(
  (target) => !TARGETS_AFTER_1_0.includes(target),
);

const NODE_SERVERS: readonly string[] = ["nestjs", "fastify", "express", "adonis", "hono"];

const PYTHON_SERVERS: readonly string[] = ["fastapi", "drf", "ninja"];

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

const refusedForm = (form: string, targets: readonly string[]): ItemAfter1_0 => ({
  targets,
  refusedOn: targets,
  reason: `1.0 refuses ${form} by name at generation on ${targets.join(", ")}`,
});

const refusedOnEveryServer = (form: string): ItemAfter1_0 => ({
  targets: SERVERS_FOR_1_0,
  refusedOn: SERVERS_FOR_1_0,
  reason: `1.0 refuses ${form} by name at generation`,
});

const refusedOnTheNodeServers = (form: string): ItemAfter1_0 => ({
  targets: NODE_SERVERS,
  refusedOn: NODE_SERVERS,
  reason: `1.0 refuses ${form} by name at generation on the Node servers`,
});

/** The after-1.0 list from its entries; an id listed twice is refused by name, as a Map would keep the last one. */
export function indexItemsAfter1_0(
  entries: readonly (readonly [string, ItemAfter1_0])[],
): ReadonlyMap<string, ItemAfter1_0> {
  const index = new Map<string, ItemAfter1_0>();

  for (const [id, deferred] of entries) {
    if (index.has(id)) throw new Error(`release-scope.ts lists ${id} twice; merge its entries.`);

    index.set(id, deferred);
  }

  return index;
}

export const ITEMS_AFTER_1_0: ReadonlyMap<string, ItemAfter1_0> = indexItemsAfter1_0([
  ["CHK-001", { targets: ["fetch", "nestjs"], reason: SCALE_CAPACITY }],
  ["CHK-002", { targets: ["fetch", "nestjs"], reason: SCALE_CAPACITY }],
  ["CHK-003", { targets: ["fetch"], reason: SCALE_CAPACITY }],
  ["CHK-004", refusedOnEveryServer(VARIANTS_FORM)],
  ["CHK-006", refusedOnEveryServer(VARIANTS_FORM)],
  [
    "CHK-013",
    {
      refusedOn: ["fetch", ...NODE_SERVERS],
      reason:
        "1.0 refuses the rights-version response header by name at generation (the fetch client); the Node servers name it in the generation warning identity.headers.handler and leave the comparison and the response header to the handler; the native servers neither refuse nor warn, so they are deferred with no test",
    },
  ],
  ["CHK-019", refusedOnEveryServer("a principal requirement")],
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
  ["CHK-020", refusedOnEveryServer("a principal binding")],
  ["CHK-094", refusedOnEveryServer("a scope resolved by the application")],
  ["CHK-150", refusedForm("a form body", BODY_AND_QUERY_FORMS_REFUSED_ON)],
  ["CHK-151", refusedForm("a multipart body", BODY_AND_QUERY_FORMS_REFUSED_ON)],
  ["CHK-152", refusedForm("a file download", BODY_AND_QUERY_FORMS_REFUSED_ON)],
  ["CHK-160", refusedForm("a query list in brackets form", BODY_AND_QUERY_FORMS_REFUSED_ON)],
  ...["CHK-074", "CHK-077", "CHK-078", "CHK-103"].map((id): [string, ItemAfter1_0] => [
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
  ["CHK-085", { reason: API_PLATFORM_AFTER_V1 }],
  [
    "CHK-088",
    {
      reason:
        "internal PHP packaging, covered by the PHP split job that installs each mirror alone",
    },
  ],
  ["CHK-100", { reason: API_PLATFORM_AFTER_V1 }],
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
  ["CHK-167", { reason: API_PLATFORM_AFTER_V1 }],
  ["CHK-176", { reason: "internal fixture completeness; the classification itself is CHK-175" }],
]);

/** Whether the 1.0 gate leaves the pair of [id] and [target] for after 1.0. */
export function isDeferredPair(
  itemsAfter1_0: ReadonlyMap<string, ItemAfter1_0>,
  id: string,
  target: string,
): boolean {
  if (TARGETS_AFTER_1_0.includes(target)) return true;

  const deferred = itemsAfter1_0.get(id);

  return deferred !== undefined && (deferred.targets?.includes(target) ?? true);
}

/** The targets of an item the release gate requires: its concrete targets without the pairs after 1.0. */
export function releaseGateTargets(
  item: Item,
  itemsAfter1_0: ReadonlyMap<string, ItemAfter1_0>,
): string[] {
  return expandTargets(item.targets).filter(
    (target) => !isDeferredPair(itemsAfter1_0, item.id, target),
  );
}

/**
 * Each entry of the after-1.0 list that no longer holds: an unknown or retired id, a target the item does not list,
 * an empty reason, a pair that [proven] says a proof or a suite report now proves, or a refusal that [refusalProven]
 * says no proof file tests.
 */
export function releaseScopeProblems(
  items: readonly Item[],
  itemsAfter1_0: ReadonlyMap<string, ItemAfter1_0>,
  proven: (id: string, target: string) => boolean,
  refusalProven: (id: string, target: string) => boolean,
): Problem[] {
  const problems: Problem[] = [];
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const [id, deferred] of itemsAfter1_0) {
    const at = (message: string) => problems.push({ file: RELEASE_SCOPE_FILE, id, message });
    const item = byId.get(id);

    if (item === undefined) {
      at("after-1.0 list names an unknown id (not in the checklist)");
      continue;
    }

    if (item.retired !== undefined) {
      at(`after-1.0 list names a retired id (retired: ${item.retired})`);
      continue;
    }

    if (deferred.reason.trim() === "") at("after-1.0 entry without a reason");

    const listed = expandTargets(item.targets);

    for (const target of deferred.targets ?? []) {
      if (!listed.includes(target))
        at(`after-1.0 entry names a target the item does not list: ${target}`);
    }

    for (const target of deferred.targets ?? listed) {
      if (listed.includes(target) && proven(id, target))
        at(`proven for target ${target}: drop it from the after-1.0 list`);
    }

    for (const message of refusalProblems(id, deferred, listed, refusalProven)) at(message);
  }

  return problems;
}

/** The refusal named by [deferred] on a target it does not defer or that no proof file tests. */
function refusalProblems(
  id: string,
  deferred: ItemAfter1_0,
  listed: readonly string[],
  refusalProven: (id: string, target: string) => boolean,
): string[] {
  return (deferred.refusedOn ?? []).flatMap((target) => {
    if (!listed.includes(target) || !(deferred.targets ?? listed).includes(target))
      return [`after-1.0 entry names a refusal on a target it does not defer: ${target}`];

    return refusalProven(id, target)
      ? []
      : [`refused on target ${target} with no refusal test in a proof file`];
  });
}

/** One line per item after 1.0, for the gate summary. */
export function itemsAfter1_0Lines(itemsAfter1_0: ReadonlyMap<string, ItemAfter1_0>): string[] {
  return [...itemsAfter1_0].map(([id, deferred]) => {
    const scope = deferred.targets === undefined ? "" : ` on ${deferred.targets.join(", ")}`;

    return `release gate: not required before 1.0: ${id}${scope} (${deferred.reason})`;
  });
}
