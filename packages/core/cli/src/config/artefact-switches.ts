import type { ArtefactDeclaration, Target } from "@seampact/codegen-core";
import {
  type ArtefactSwitches,
  BOOT_CHECK_ARTEFACT,
  type HookBootCheckLevel,
  type TargetEntry,
} from "@seampact/spec/config";
import { type CliProblem, entryWhere } from "../cli-problem.js";

// The artefacts a target entry generates (ADR 0009 "Artefacts and the compatibility matrix", ADR 0011 "The app
// config"): each artefact the target declares, at its declared default unless the entry's `artefacts` switches it.
// `nativeDocs` has no default of its own: it is off unless the target declares it on. A target that declares tunable
// boot checks (`metadata.bootChecks`) without a `bootCheck` artefact takes `bootCheck` as a boolean too: `false` turns
// those checks off, read by the boot check itself.

export type ArtefactSelection =
  | { status: "selected"; artefacts: ReadonlySet<string> }
  | { status: "refused"; problems: CliProblem[] };

export const NATIVE_DOCS_ARTEFACT = "nativeDocs";

export function selectArtefacts(entry: TargetEntry, target: Target): ArtefactSelection {
  const declared = target.metadata.artefacts;
  const switches = booleanSwitchesOf(entry.artefacts);
  const unknown = unknownSwitchProblems(entry, target, switches);

  if (unknown.length > 0) return { status: "refused", problems: unknown };

  const artefacts = new Set(
    declared
      .filter((artefact) => switches.get(artefact.id) ?? artefact.defaultOn)
      .map((artefact) => artefact.id),
  );

  dropUnwrittenWithoutNeeds(declared, switches, artefacts);

  if (declared.length > 0 && artefacts.size === 0) {
    return { status: "refused", problems: [noArtefactProblem(entry, declared)] };
  }

  const needed = neededArtefactProblems(entry, declared, artefacts);

  if (needed.length > 0) return { status: "refused", problems: needed };

  return { status: "selected", artefacts };
}

// The `bootCheck.frameworkRoutes` switch an entry writes in `bootCheck`'s object form.
export function frameworkRoutesSwitchOf(
  artefacts: ArtefactSwitches | undefined,
): boolean | undefined {
  const bootCheck = artefacts?.[BOOT_CHECK_ARTEFACT];

  return typeof bootCheck === "object" ? bootCheck.frameworkRoutes : undefined;
}

// The `bootCheck.hooks` level an entry writes in `bootCheck`'s object form.
export function hookCheckSwitchOf(
  artefacts: ArtefactSwitches | undefined,
): HookBootCheckLevel | undefined {
  const bootCheck = artefacts?.[BOOT_CHECK_ARTEFACT];

  return typeof bootCheck === "object" ? bootCheck.hooks : undefined;
}

// `error` unless the entry writes a level. The boolean form of `bootCheck` leaves it at `error`: a missing hook is
// never silenced by accident.
export function hookCheckLevelOf(artefacts: ArtefactSwitches | undefined): HookBootCheckLevel {
  return hookCheckSwitchOf(artefacts) ?? "error";
}

// Off when the entry switches the whole boot check off, or its framework-route check alone.
export function isFrameworkRouteCheckOff(artefacts: ArtefactSwitches | undefined): boolean {
  return artefacts?.[BOOT_CHECK_ARTEFACT] === false || frameworkRoutesSwitchOf(artefacts) === false;
}

// The on and off switches by artefact id; `bootCheck`'s object form tunes its checks and leaves it at its default.
function booleanSwitchesOf(artefacts: ArtefactSwitches | undefined): ReadonlyMap<string, boolean> {
  return new Map(
    Object.entries(artefacts ?? {}).flatMap(([id, value]) =>
      typeof value === "boolean" ? [[id, value] as const] : [],
    ),
  );
}

function unknownSwitchProblems(
  entry: TargetEntry,
  target: Target,
  switches: ReadonlyMap<string, boolean>,
): CliProblem[] {
  const declaredIds = target.metadata.artefacts.map((artefact) => artefact.id);
  const tunesBootChecks = (target.metadata.bootChecks?.length ?? 0) > 0;

  return [...switches.keys()]
    .filter((id) => !declaredIds.includes(id))
    .filter((id) => !(id === BOOT_CHECK_ARTEFACT && tunesBootChecks))
    .map((id) => ({
      code: "config.artefacts.unknown",
      message: `The target '${entry.use}' declares no artefact '${id}'; it declares ${quotedList(declaredIds)}.`,
      fix: unknownSwitchFix(id),
      where: entryWhere(entry.id),
    }));
}

function unknownSwitchFix(id: string): string {
  if (id === NATIVE_DOCS_ARTEFACT) {
    return "Remove 'nativeDocs' from the entry's `artefacts`: this target completes no framework-native document, and the seampact OpenAPI document `generate` writes (`openapi/<api>.yaml` unless the app's `openapi` key places it) describes the api.";
  }

  return `Remove '${id}' from the entry's \`artefacts\`, or switch one of the artefacts the target declares.`;
}

// An artefact that only follows its needs (`leftOffWithoutNeeds`) and that the entry does not write is left off
// when a need is off; one the entry writes on stays, and is refused by `neededArtefactProblems`.
function dropUnwrittenWithoutNeeds(
  declared: readonly ArtefactDeclaration[],
  switches: ReadonlyMap<string, boolean>,
  artefacts: Set<string>,
): void {
  for (const artefact of declared) {
    if (!artefact.leftOffWithoutNeeds || switches.has(artefact.id)) continue;

    if ((artefact.needs ?? []).some((need) => !artefacts.has(need))) {
      artefacts.delete(artefact.id);
    }
  }
}

// Each generated artefact needing one that stays off, named with it.
function neededArtefactProblems(
  entry: TargetEntry,
  declared: readonly ArtefactDeclaration[],
  artefacts: ReadonlySet<string>,
): CliProblem[] {
  return declared
    .filter((artefact) => artefacts.has(artefact.id))
    .flatMap((artefact) =>
      (artefact.needs ?? [])
        .filter((need) => !artefacts.has(need))
        .map((need) => ({
          code: "config.artefacts.needed",
          message: `The artefact '${artefact.id}' of the target '${entry.use}' needs '${need}', which the entry leaves off.`,
          fix: `Switch '${need}' on, or switch '${artefact.id}' off too.`,
          where: entryWhere(entry.id),
        })),
    );
}

// An entry generating nothing would only empty its output directory.
function noArtefactProblem(
  entry: TargetEntry,
  declared: readonly ArtefactDeclaration[],
): CliProblem {
  const declaredIds = declared.map((artefact) => artefact.id);

  return {
    code: "config.artefacts.none",
    message: `The entry leaves off every artefact the target '${entry.use}' declares (${quotedList(declaredIds)}), so it would generate nothing.`,
    fix: "Remove the entry from `targets`, or switch one of its artefacts on.",
    where: entryWhere(entry.id),
  };
}

function quotedList(ids: readonly string[]): string {
  return ids.map((id) => `'${id}'`).join(", ");
}
