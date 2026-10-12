// The checklist's target vocabulary (docs/conformance/checklist.yaml header, A17).
// "server" and "all targets" are aliases that expand to concrete targets.

export const SERVER_TARGETS: readonly string[] = [
  "nestjs",
  "fastify",
  "express",
  "adonis",
  "spring-boot",
  "laravel",
  "symfony",
  "api-platform",
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
