import {
  closestKeyword,
  type Diagnostic,
  type DiagnosticOrigin,
  diagnosticLocationKey,
  pointerEscape,
} from "@seampact/compiler";
import type { Lint, LintAllow, Origin, SourceMap } from "@seampact/spec/ir";
import {
  CORE_PLUGIN_NAME,
  type LintPlugin,
  type LintRuleDefinition,
  type LintSeverity,
  lintRuleId,
} from "./plugin.js";

// Severity and allows (ADR 0006 section 4, grammar 12): a rule's severity is the contract's setting, else the
// rule's default; an allow silences a finding at a place the rule names, the compiler having set `subtree: false`
// for every allow that holds at its own node only.

export const UNKNOWN_RULE_ID = `${CORE_PLUGIN_NAME}/lint/unknown-rule`;
export const UNCLAIMED_RULE_ID = `${CORE_PLUGIN_NAME}/lint/unclaimed-rule`;

export function lintSeverityOf(lint: Lint, id: string, rule: LintRuleDefinition): LintSeverity {
  const set = Object.hasOwn(lint.rules, id) ? lint.rules[id] : undefined;

  if (set === undefined) return rule.defaultSeverity;

  switch (set.severity) {
    case "disabled":
      return "disabled";
    case "warning":
      return "warning";
    case "error":
      return "error";
    default:
      throw new Error(
        `lint.rules sets '${id}' to '${set.severity}': use disabled, warning or error`,
      );
  }
}

function sameOrigin(a: Origin, b: Origin): boolean {
  return a.layer === b.layer && a.pointer === b.pointer;
}

function isBelow(pointer: string, ancestor: string): boolean {
  return pointer.startsWith(`${ancestor}/`);
}

function allowCovers(allow: LintAllow, place: Origin): boolean {
  if (sameOrigin(allow.at, place)) return true;

  return (
    allow.subtree && allow.at.layer === place.layer && isBelow(place.pointer, allow.at.pointer)
  );
}

/** Whether an allow of `ruleId` covers one of the places, in the layer and pointer sense of ADR 0004 section 11. */
export function lintIsAllowed(lint: Lint, ruleId: string, places: readonly Origin[]): boolean {
  return lint.allows.some(
    (allow) => allow.rule === ruleId && places.some((place) => allowCovers(allow, place)),
  );
}

function pluginPrefix(id: string): string {
  return id.includes("/") ? id.slice(0, id.indexOf("/")) : "";
}

interface RuleMention {
  id: string;
  where: "lint.rules" | "lint.allow";
  origin: Origin;
}

function mentionsOf(lint: Lint, locations: SourceMap["locations"]): RuleMention[] {
  return [
    ...Object.entries(lint.rules).map(
      ([id, rule]): RuleMention => ({ id, where: "lint.rules", origin: rule.origin }),
    ),
    ...lint.allows.map(
      (allow): RuleMention => ({
        id: allow.rule,
        where: "lint.allow",
        origin: allowEntryOrigin(allow, locations),
      }),
    ),
  ];
}

// The `lint.allow` entry that wrote the id, when the side table has it; else the node holding the allow.
function allowEntryOrigin(allow: LintAllow, locations: SourceMap["locations"]): Origin {
  const entry = {
    layer: allow.at.layer,
    pointer: `${allow.at.pointer}/lint/allow/${pointerEscape(allow.rule)}`,
  };

  return Object.hasOwn(locations, diagnosticLocationKey(entry)) ? entry : allow.at;
}

/** The origin of a diagnostic: `core` has no location, and a relay copy is located in the api that wrote it. */
export function diagnosticOriginOf(origin: Origin): DiagnosticOrigin {
  if (origin.layer === "core")
    throw new Error(`a lint setting cannot be located at a core origin ${origin.pointer}`);

  return { layer: origin.layer, pointer: origin.pointer };
}

function unknownRuleDiagnostic(mention: RuleMention, owner: LintPlugin): Diagnostic {
  const known = owner.rules.map((rule) => lintRuleId(owner, rule));
  const closest = closestKeyword(mention.id, known);

  return {
    severity: "error",
    rule: UNKNOWN_RULE_ID,
    message: `${mention.where} names the lint rule '${mention.id}', which the plugin '${owner.name}' does not have`,
    fix:
      closest === undefined
        ? `Use one of ${known.join(", ")}, or remove the entry.`
        : `Use '${closest}', or remove the entry.`,
    origin: diagnosticOriginOf(mention.origin),
    related: [],
  };
}

function unclaimedRuleDiagnostic(mention: RuleMention): Diagnostic {
  return {
    severity: "warning",
    rule: UNCLAIMED_RULE_ID,
    message: `${mention.where} names the lint rule '${mention.id}', which no loaded plugin owns, so the setting is ignored`,
    fix: "Load the plugin that owns the rule, or remove the entry.",
    origin: diagnosticOriginOf(mention.origin),
    related: [],
  };
}

/**
 * An id under a loaded plugin's prefix that the plugin lacks is an error at its origin; an id no loaded plugin
 * owns is a warning, since the setting is ignored (the standalone binary loads the core rules only).
 */
export function lintUnknownRuleDiagnostics(
  lint: Lint,
  plugins: readonly LintPlugin[],
  reservedIds: readonly string[],
  locations: SourceMap["locations"],
): Diagnostic[] {
  const known = new Set([
    ...reservedIds,
    ...plugins.flatMap((plugin) => plugin.rules.map((rule) => lintRuleId(plugin, rule))),
  ]);
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  for (const mention of mentionsOf(lint, locations)) {
    const key = `${mention.where}\n${mention.id}\n${mention.origin.layer}#${mention.origin.pointer}`;

    if (known.has(mention.id) || seen.has(key)) continue;
    seen.add(key);
    const owner = plugins.find((plugin) => plugin.name === pluginPrefix(mention.id));

    diagnostics.push(
      owner === undefined
        ? unclaimedRuleDiagnostic(mention)
        : unknownRuleDiagnostic(mention, owner),
    );
  }

  return diagnostics;
}
