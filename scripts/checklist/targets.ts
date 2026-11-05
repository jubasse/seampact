// The checklist's target vocabulary (docs/conformance/checklist.yaml header, A17).
// "server" and "all targets" are aliases that expand to concrete targets.

export const SERVER_TARGETS: readonly string[] = [
  "nestjs",
  "fastify",
  "express",
  "adonis",
  "hono",
  "spring-boot",
  "laravel",
  "symfony",
  "api-platform",
  "fastapi",
  "drf",
  "ninja",
];

export const CONCRETE_TARGETS: readonly string[] = [
  "core",
  ...SERVER_TARGETS,
  "fetch",
  "zod",
  "yup",
  "class-validator",
  "react",
  "angular",
  "vue",
  "nestjs-casl",
  "laravel-spatie",
];

/**
 * The consumers that run their target in another framework major or module format, and report under their own id:
 * the report's target variant, and the concrete target it proves. The one table every reader of a report uses.
 */
export const TARGET_VARIANTS: ReadonlyMap<string, string> = new Map([
  ["nestjs-cjs", "nestjs"],
  ["adonis6", "adonis"],
  ["express4", "express"],
]);

/** Targets the 1.0 release gate does not require: API Platform comes after v1. */
export const TARGETS_AFTER_1_0: readonly string[] = ["api-platform"];

export const ALIASES = ["server", "all targets"] as const;

export function isKnownTarget(target: string): boolean {
  return CONCRETE_TARGETS.includes(target) || (ALIASES as readonly string[]).includes(target);
}

/** The concrete targets an item's `targets` list stands for, sorted and unique. */
export function expandTargets(targets: readonly string[]): string[] {
  const out = new Set<string>();

  for (const target of targets) {
    if (target === "server") for (const t of SERVER_TARGETS) out.add(t);
    else if (target === "all targets") for (const t of CONCRETE_TARGETS) out.add(t);
    else out.add(target);
  }

  return [...out].sort();
}

/** The concrete target a suite report's target names, a variant mapped to its target; undefined when unknown. */
export function reportTargetOf(reportTarget: string): string | undefined {
  const target = TARGET_VARIANTS.get(reportTarget) ?? reportTarget;

  return SERVER_TARGETS.includes(target) ? target : undefined;
}

/** The targets of an item the release gate requires: its concrete targets without those that come after 1.0. */
export function releaseGateTargets(targets: readonly string[]): string[] {
  return expandTargets(targets).filter((target) => !TARGETS_AFTER_1_0.includes(target));
}
