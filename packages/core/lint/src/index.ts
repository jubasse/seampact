// The lint plugin API, the core rules (plugin `seampact`) and the runner that applies `lint.rules` and `lint.allow`.

export { LINT_RESERVED_RULE_IDS, seampactCorePlugin } from "./core/plugin.js";
export type {
  LintDeclared,
  LintFinding,
  LintPlugin,
  LintRuleContext,
  LintRuleDefinition,
  LintSeverity,
} from "./plugin.js";
export { defineLintPlugin, isDefinedLintPlugin, lintRuleId } from "./plugin.js";
export type { RunLintInput } from "./run-lint.js";
export { runLint } from "./run-lint.js";
export { UNCLAIMED_RULE_ID, UNKNOWN_RULE_ID } from "./resolve.js";
export type { LintPluginProblem, LoadLintPluginsOutcome } from "./plugin-loader.js";
export { loadLintPlugins } from "./plugin-loader.js";
