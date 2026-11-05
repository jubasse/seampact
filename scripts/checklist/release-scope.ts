// What the 1.0 release gate does not require: the targets and the checklist items that come after 1.0, each item
// with its reason. A release policy over the checklist, which stays the list of facts.
import type { Item, Problem } from "./model.ts";
import { expandTargets } from "./targets.ts";

export const RELEASE_SCOPE_FILE = "scripts/checklist/release-scope.ts";

/** Targets the 1.0 release gate does not require: API Platform comes after v1. */
export const TARGETS_AFTER_1_0: readonly string[] = ["api-platform"];

/** An item the 1.0 gate does not require: on the targets named, or on all its targets without `targets`. */
export interface ItemAfter1_0 {
  readonly targets?: readonly string[];
  readonly reason: string;
}

const SCALE_CAPACITY =
  "generated code at scale: no behaviour a fix would change; scripts/golden/scale.test.ts proves the core pair";
const API_PLATFORM_AFTER_V1 = "API Platform comes after v1";

export const ITEMS_AFTER_1_0: ReadonlyMap<string, ItemAfter1_0> = new Map([
  ["CHK-001", { targets: ["fetch", "nestjs"], reason: SCALE_CAPACITY }],
  ["CHK-002", { targets: ["fetch", "nestjs"], reason: SCALE_CAPACITY }],
  ["CHK-003", { targets: ["fetch"], reason: SCALE_CAPACITY }],
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
 * an empty reason, or a pair that [proven] says a proof or a suite report now proves.
 */
export function releaseScopeProblems(
  items: readonly Item[],
  itemsAfter1_0: ReadonlyMap<string, ItemAfter1_0>,
  proven: (id: string, target: string) => boolean,
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
  }

  return problems;
}

/** One line per item after 1.0, for the gate summary. */
export function itemsAfter1_0Lines(itemsAfter1_0: ReadonlyMap<string, ItemAfter1_0>): string[] {
  return [...itemsAfter1_0].map(([id, deferred]) => {
    const scope = deferred.targets === undefined ? "" : ` on ${deferred.targets.join(", ")}`;

    return `release gate: not required before 1.0: ${id}${scope} (${deferred.reason})`;
  });
}
