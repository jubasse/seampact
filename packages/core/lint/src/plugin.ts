import type { RelatedLocation } from "@seampact/compiler";
import type { ContractIR, Origin } from "@seampact/spec/ir";

// The lint plugin API (ADR 0006 section 4, FR-12): a plugin is a name and rules; a rule reads the IR only and
// reports findings. Rule ids are `<plugin>/<rule>`.

export type LintSeverity = "disabled" | "warning" | "error";

export interface LintFinding {
  message: string;
  fix: string;
  /** Where the finding is printed: never a `core` origin, never a relay copy (`api` set). */
  origin: Origin;
  /** Where an allow silences it, nearest first; `origin` is not implied. */
  allowAt: readonly Origin[];
  related?: readonly RelatedLocation[];
}

/** A catalogue entry the contract's layers declare, which finalize prunes from the IR when nothing reaches it. */
export interface LintDeclared {
  catalogue: string;
  id: string;
  origin: Origin;
}

export interface LintRuleContext {
  readonly ir: ContractIR;
  readonly declared: readonly LintDeclared[];
  report(finding: LintFinding): void;
}

export interface LintRuleDefinition {
  /** Kebab case, unique in the plugin. */
  name: string;
  defaultSeverity: LintSeverity;
  /** One sentence: what the rule reports. */
  reports: string;
  /** Where an allow silences it. */
  silencedOn: string;
  check(context: LintRuleContext): void;
}

export interface LintPlugin {
  /** Kebab case; ids are `${name}/${rule.name}`. */
  name: string;
  rules: readonly LintRuleDefinition[];
}

export const CORE_PLUGIN_NAME = "seampact";

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

// A registry symbol, so a plugin package holding its own copy of this package is still recognised.
const DEFINED_BRAND = Symbol.for("seampact.lint.definedPlugin");

/** Whether a value is a result of `defineLintPlugin`. */
export function isDefinedLintPlugin(value: unknown): value is LintPlugin {
  return typeof value === "object" && value !== null && Object.hasOwn(value, DEFINED_BRAND);
}

/** The full id of a rule. */
export function lintRuleId(plugin: LintPlugin, rule: LintRuleDefinition): string {
  return `${plugin.name}/${rule.name}`;
}

/** Checks the names of a house plugin and returns it frozen; the name `seampact` is the core plugin's. */
export function defineLintPlugin(plugin: LintPlugin): LintPlugin {
  if (plugin.name === CORE_PLUGIN_NAME)
    throw new Error(
      `the lint plugin name '${CORE_PLUGIN_NAME}' is reserved for the core rules: rename the plugin`,
    );

  return frozenPlugin(plugin);
}

/** The core plugin only (`seampact`); not exported from the package. */
export function defineCoreLintPlugin(plugin: LintPlugin): LintPlugin {
  if (plugin.name !== CORE_PLUGIN_NAME)
    throw new Error(`the core lint plugin is named '${CORE_PLUGIN_NAME}', not '${plugin.name}'`);

  return frozenPlugin(plugin);
}

function frozenPlugin(plugin: LintPlugin): LintPlugin {
  if (!NAME_PATTERN.test(plugin.name))
    throw new Error(
      `the lint plugin name '${plugin.name}' is not kebab case: use lowercase letters, digits and '-', starting with a letter`,
    );

  const seen = new Set<string>();

  for (const rule of plugin.rules) {
    if (!NAME_PATTERN.test(rule.name))
      throw new Error(
        `the lint rule name '${rule.name}' of plugin '${plugin.name}' is not kebab case: use lowercase letters, digits and '-', starting with a letter`,
      );

    if (seen.has(rule.name))
      throw new Error(
        `the lint plugin '${plugin.name}' declares the rule '${rule.name}' twice: rename one`,
      );
    seen.add(rule.name);
  }

  return Object.freeze({
    name: plugin.name,
    rules: Object.freeze(plugin.rules.map((rule) => Object.freeze({ ...rule }))),
    [DEFINED_BRAND]: true,
  });
}
