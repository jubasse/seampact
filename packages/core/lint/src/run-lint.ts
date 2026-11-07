import {
  type Diagnostic,
  type DiagnosticOrigin,
  diagnosticLocationKey,
  diagnosticSort,
} from "@seampact/compiler";
import type { ContractIR, Origin, SourceMap } from "@seampact/spec/ir";
import { describeError } from "./describe-error.js";
import { LINT_RESERVED_RULE_IDS, seampactCorePlugin } from "./core/plugin.js";
import {
  type LintDeclared,
  type LintFinding,
  type LintPlugin,
  type LintRuleContext,
  type LintRuleDefinition,
  lintRuleId,
} from "./plugin.js";
import {
  diagnosticOriginOf,
  lintIsAllowed,
  lintSeverityOf,
  lintUnknownRuleDiagnostics,
} from "./resolve.js";

export interface RunLintInput {
  /** The finalized IR of one api. */
  ir: ContractIR;
  /** The api's declared catalogue entries (`PipelineApiResult.declared`). */
  declared: readonly LintDeclared[];
  /** The api's whole raw side table (`PipelineApiResult.locations`). */
  locations: SourceMap["locations"];
  /** The house plugins, after the core plugin which always runs first. */
  plugins: readonly LintPlugin[];
}

/**
 * Lints one api (ADR 0006 section 4): each rule not `disabled` reads the IR, a finding an allow covers is dropped,
 * the rest becomes a diagnostic with its resolved severity. A rule's check may be async; one that rejects is an
 * error naming it, as is one that throws. The result is sorted; printing is the caller's.
 */
export async function runLint(input: RunLintInput): Promise<Diagnostic[]> {
  const plugins = [seampactCorePlugin, ...input.plugins];

  refuseDuplicatePlugins(plugins);

  const diagnostics: Diagnostic[] = [
    ...lintUnknownRuleDiagnostics(input.ir.lint, plugins, LINT_RESERVED_RULE_IDS, input.locations),
  ];

  for (const plugin of plugins) {
    for (const rule of plugin.rules) {
      const id = lintRuleId(plugin, rule);
      const severity = lintSeverityOf(input.ir.lint, id, rule);

      if (severity === "disabled") continue;
      const findings: LintFinding[] = [];
      const rejection = await checkRule(rule, {
        ir: input.ir,
        declared: input.declared,
        report: (finding) => findings.push(finding),
      });

      if (rejection !== undefined) {
        diagnostics.push(rejectedRuleDiagnostic(plugin, id, rejection, input));
        continue;
      }

      for (const finding of findings) {
        if (lintIsAllowed(input.ir.lint, id, finding.allowAt)) continue;
        diagnostics.push(diagnosticOf(id, severity, finding, input.locations));
      }
    }
  }

  return diagnosticSort(diagnostics, input.locations);
}

interface LintRejection {
  cause: unknown;
}

// A check that throws or rejects fails; its cause is returned.
async function checkRule(
  rule: LintRuleDefinition,
  context: LintRuleContext,
): Promise<LintRejection | undefined> {
  try {
    await rule.check(context);
  } catch (cause) {
    return { cause };
  }

  return undefined;
}

// Located at the api header: a failed check has no place in the contract.
function rejectedRuleDiagnostic(
  plugin: LintPlugin,
  id: string,
  rejection: LintRejection,
  input: RunLintInput,
): Diagnostic {
  return {
    severity: "error",
    rule: id,
    message: `The lint rule '${id}' of plugin '${plugin.name}' failed: ${describeError(rejection.cause)}`,
    fix: `Fix the rule in plugin '${plugin.name}', or set '${id}' to disabled in lint.rules.`,
    origin: findingOrigin(id, input.ir.api.origin, input.locations),
    related: [],
  };
}

function refuseDuplicatePlugins(plugins: readonly LintPlugin[]): void {
  const seen = new Set<string>();

  for (const plugin of plugins) {
    if (seen.has(plugin.name))
      throw new Error(`the lint plugin '${plugin.name}' is given twice: pass it once`);
    seen.add(plugin.name);
  }
}

function diagnosticOf(
  id: string,
  severity: "warning" | "error",
  finding: LintFinding,
  locations: SourceMap["locations"],
): Diagnostic {
  const origin = findingOrigin(id, finding.origin, locations);

  return {
    severity,
    rule: id,
    message: finding.message,
    fix: finding.fix,
    origin,
    related: (finding.related ?? []).map((related) => ({
      origin: findingOrigin(id, related.origin, locations),
      message: related.message,
    })),
  };
}

// A finding the table cannot locate is a defect of the rule, not of the contract.
function findingOrigin(
  id: string,
  origin: Origin,
  locations: SourceMap["locations"],
): DiagnosticOrigin {
  if (origin.api !== undefined)
    throw new Error(
      `the lint rule '${id}' reported a finding at a relay copy from api '${origin.api}': report at the api that declares it`,
    );

  const located = diagnosticOriginOf(origin);
  const key = diagnosticLocationKey(located);

  if (!Object.hasOwn(locations, key))
    throw new Error(
      `the lint rule '${id}' reported a finding at '${key}', which the side table lacks`,
    );

  return located;
}
