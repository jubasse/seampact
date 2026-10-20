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
  /** Whether an operation, an identity or a convention reaches it, as the compiler found. */
  reached: boolean;
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
  /** May be async: the runner waits for it, and a rejection is an error diagnostic naming the rule. */
  check(context: LintRuleContext): void | Promise<void>;
}

export interface LintPlugin {
  /** Kebab case; ids are `${name}/${rule.name}`. */
  name: string;
  rules: readonly LintRuleDefinition[];
}

export const CORE_PLUGIN_NAME = "seampact";

/** The version of this plugin API; a plugin built against another one is refused by the loader. */
export const LINT_PLUGIN_API_VERSION = 1;

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

const SEVERITIES: ReadonlySet<unknown> = new Set<LintSeverity>(["disabled", "warning", "error"]);

// A registry symbol, so a plugin package holding its own copy of this package is still recognised. Its value is
// the plugin API version the plugin was built against.
const DEFINED_BRAND = Symbol.for("seampact.lint.definedPlugin");

/** Whether a value carries the brand `defineLintPlugin` puts on its result, of any API version. */
export function isDefinedLintPlugin(value: unknown): value is LintPlugin {
  return typeof value === "object" && value !== null && Object.hasOwn(value, DEFINED_BRAND);
}

/** The plugin API version a branded plugin was built against, as its brand holds it. */
export function lintPluginApiVersion(plugin: LintPlugin): unknown {
  return Reflect.get(plugin, DEFINED_BRAND);
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
  lintAssertPlugin(plugin);

  return Object.freeze({
    name: plugin.name,
    rules: Object.freeze(plugin.rules.map((rule) => Object.freeze({ ...rule }))),
    [DEFINED_BRAND]: LINT_PLUGIN_API_VERSION,
  });
}

/**
 * Checks a value is a plugin as `defineLintPlugin` accepts it, for `defineLintPlugin` and for a loaded package
 * alike; throws the first problem found.
 */
export function lintAssertPlugin(value: unknown): asserts value is LintPlugin {
  const name = memberOf(value, "name");

  if (typeof name !== "string" || !NAME_PATTERN.test(name))
    throw new Error(
      `the lint plugin name '${String(name)}' is not kebab case: use lowercase letters, digits and '-', starting with a letter`,
    );

  const rules = memberOf(value, "rules");

  if (!Array.isArray(rules))
    throw new Error(`the lint plugin '${name}' has no rules list: give 'rules' an array`);
  const seen = new Set<string>();

  for (const rule of rules) {
    const ruleName = assertRule(name, rule);

    if (seen.has(ruleName))
      throw new Error(
        `the lint plugin '${name}' declares the rule '${ruleName}' twice: rename one`,
      );
    seen.add(ruleName);
  }
}

// Checks one rule of plugin `pluginName` and returns its name.
function assertRule(pluginName: string, rule: unknown): string {
  const name = memberOf(rule, "name");

  if (typeof name !== "string" || !NAME_PATTERN.test(name))
    throw new Error(
      `the lint rule name '${String(name)}' of plugin '${pluginName}' is not kebab case: use lowercase letters, digits and '-', starting with a letter`,
    );

  const severity = memberOf(rule, "defaultSeverity");

  if (!SEVERITIES.has(severity))
    throw new Error(
      `the lint rule '${name}' of plugin '${pluginName}' has the default severity '${String(severity)}': use disabled, warning or error`,
    );

  if (typeof memberOf(rule, "check") !== "function")
    throw new Error(
      `the lint rule '${name}' of plugin '${pluginName}' has no check function: give it 'check'`,
    );

  for (const text of ["reports", "silencedOn"])
    if (typeof memberOf(rule, text) !== "string")
      throw new Error(
        `the lint rule '${name}' of plugin '${pluginName}' has no '${text}' sentence: give it one`,
      );

  return name;
}

function memberOf(value: unknown, member: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, member) : undefined;
}
