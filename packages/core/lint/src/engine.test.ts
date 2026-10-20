import type { ContractIR, Lint, Origin } from "@seampact/spec/ir";
import { describe, expect, test, vi } from "vitest";
import {
  defineLintPlugin,
  type LintFinding,
  type LintPlugin,
  type LintRuleDefinition,
  lintAssertPlugin,
} from "./plugin.js";
import { runLint } from "./run-lint.js";
import { compiledFixtureApi, lintInputOf, rulesOf } from "./test-support.js";

const api = compiledFixtureApi("engine");

const ALPHA: Origin = { layer: "api", pointer: "/surfaces/app/routes/alpha" };
const BETA: Origin = { layer: "api", pointer: "/surfaces/app/routes/beta" };
const SURFACE: Origin = { layer: "api", pointer: "/surfaces/app" };
const SCHEME: Origin = { layer: "api", pointer: "/schemes/bearer" };
const NO_LINT: Lint = { rules: {}, allows: [] };

// A house rule that reports once per place it is given, allowing at the place itself.
function probePlugin(places: readonly Origin[], check = vi.fn()): LintPlugin {
  return defineLintPlugin({
    name: "test",
    rules: [
      {
        name: "probe",
        defaultSeverity: "warning",
        reports: "a place",
        silencedOn: "the place",
        check(context) {
          check();

          for (const place of places) context.report(findingAt(place));
        },
      },
    ],
  });
}

function probeRule(): LintRuleDefinition {
  const [rule] = probePlugin([]).rules;

  if (rule === undefined) throw new Error("the probe plugin has no rule");

  return rule;
}

function findingAt(place: Origin): LintFinding {
  return {
    message: `Place ${place.pointer} is probed.`,
    fix: "Stop probing it.",
    origin: place,
    allowAt: [place],
  };
}

function lintedWith(lint: Lint, plugin: LintPlugin) {
  const ir: ContractIR = { ...api.ir, lint };

  return runLint({ ...lintInputOf(api, [plugin]), ir });
}

const allowAt = (at: Origin, subtree: boolean, rule = "test/probe") => ({
  rule,
  at,
  reason: "Because.",
  subtree,
});

const ruleAt = (severity: "disabled" | "warning" | "error", origin = SURFACE) => ({
  severity,
  origin,
});

describe("severity", () => {
  test("a rule reports at its default severity", async () => {
    expect(rulesOf(await lintedWith(NO_LINT, probePlugin([ALPHA])))).toEqual([
      "warning test/probe",
    ]);
  });

  test("lint.rules sets the severity", async () => {
    const lint: Lint = { rules: { "test/probe": ruleAt("error") }, allows: [] };

    expect(rulesOf(await lintedWith(lint, probePlugin([ALPHA])))).toEqual(["error test/probe"]);
  });

  test("a disabled rule is not run", async () => {
    const check = vi.fn();
    const lint: Lint = { rules: { "test/probe": ruleAt("disabled") }, allows: [] };

    expect(await lintedWith(lint, probePlugin([ALPHA], check))).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });
});

describe("allows", () => {
  test("an allow at the exact place silences the finding there only", async () => {
    const lint: Lint = { rules: {}, allows: [allowAt(ALPHA, false)] };
    const diagnostics = await lintedWith(lint, probePlugin([ALPHA, BETA]));

    expect(diagnostics.map((diagnostic) => diagnostic.origin.pointer)).toEqual([BETA.pointer]);
  });

  test("an allow in another layer silences nothing", async () => {
    const lint: Lint = {
      rules: {},
      allows: [allowAt({ layer: "shared", pointer: ALPHA.pointer }, true)],
    };

    expect(await lintedWith(lint, probePlugin([ALPHA]))).toHaveLength(1);
  });

  test("a subtree allow reaches a place below it", async () => {
    const lint: Lint = { rules: {}, allows: [allowAt(SURFACE, true)] };

    expect(await lintedWith(lint, probePlugin([ALPHA, BETA]))).toEqual([]);
  });

  test("an allow that is not a subtree allow holds at its own place only (CHK-121)", async () => {
    const lint: Lint = { rules: {}, allows: [allowAt(SURFACE, false)] };

    expect(
      (await lintedWith(lint, probePlugin([ALPHA, SURFACE]))).map((d) => d.origin.pointer),
    ).toEqual([ALPHA.pointer]);
  });

  test("a path that merely starts like the allow's place is not below it", async () => {
    const lint: Lint = {
      rules: {},
      allows: [allowAt({ layer: "api", pointer: "/surfaces/ap" }, true)],
    };

    expect(await lintedWith(lint, probePlugin([ALPHA]))).toHaveLength(1);
  });

  test("an allow on a catalogue entry silences the finding on it (CHK-137)", async () => {
    const lint: Lint = { rules: {}, allows: [allowAt(SCHEME, false)] };

    expect(await lintedWith(lint, probePlugin([SCHEME]))).toEqual([]);
  });

  test("a finding is silenced by any place of allowAt", async () => {
    const plugin = defineLintPlugin({
      name: "test",
      rules: [
        {
          name: "probe",
          defaultSeverity: "warning",
          reports: "a place",
          silencedOn: "the route or the surface",
          check: (context) => context.report({ ...findingAt(ALPHA), allowAt: [ALPHA, SURFACE] }),
        },
      ],
    });
    const lint: Lint = { rules: {}, allows: [allowAt(SURFACE, false)] };

    expect(await lintedWith(lint, plugin)).toEqual([]);
  });
});

describe("unknown rule ids", () => {
  test("an unknown id under the core prefix is an error naming the core ids", async () => {
    const lint: Lint = {
      rules: { "seampact/credential-nam": ruleAt("error") },
      allows: [],
    };
    const [diagnostic, ...rest] = await lintedWith(lint, probePlugin([]));

    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({
      severity: "error",
      rule: "seampact/lint/unknown-rule",
      origin: SURFACE,
    });
    expect(diagnostic?.message).toContain("seampact/credential-nam");
    expect(diagnostic?.fix).toContain("seampact/credential-name");
  });

  test("an unknown allow of a loaded plugin is an error at the allow", async () => {
    const lint: Lint = { rules: {}, allows: [allowAt(ALPHA, true, "test/missing")] };
    const [diagnostic] = await lintedWith(lint, probePlugin([]));

    expect(diagnostic).toMatchObject({ rule: "seampact/lint/unknown-rule", origin: ALPHA });
    expect(diagnostic?.message).toContain("lint.allow");
  });

  test("an id no loaded plugin owns is a warning and the setting is ignored", async () => {
    const lint: Lint = { rules: { "acme/served-at": ruleAt("error") }, allows: [] };
    const [diagnostic, ...rest] = await lintedWith(lint, probePlugin([]));

    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({ severity: "warning", rule: "seampact/lint/unclaimed-rule" });
    expect(diagnostic?.message).toContain("acme/served-at");
    expect(diagnostic?.message).toContain("ignored");
  });

  test("the reserved core id is accepted", async () => {
    const lint: Lint = {
      rules: { "seampact/field-right-unresolved": ruleAt("disabled") },
      allows: [],
    };

    expect(await lintedWith(lint, probePlugin([]))).toEqual([]);
  });

  test("the unknown-rule error has no severity setting and no allow", async () => {
    const lint: Lint = {
      rules: {
        "seampact/nope": ruleAt("warning"),
        "seampact/lint/unknown-rule": ruleAt("disabled"),
      },
      allows: [allowAt(SURFACE, true, "seampact/lint/unknown-rule")],
    };
    const diagnostics = await lintedWith(lint, probePlugin([]));

    expect(diagnostics.filter((d) => d.rule === "seampact/lint/unknown-rule").length).toBe(3);
    expect(diagnostics.every((d) => d.severity === "error")).toBe(true);
  });
});

describe("plugins", () => {
  test("a name outside kebab case is refused", () => {
    expect(() => defineLintPlugin({ name: "Acme", rules: [] })).toThrow(/'Acme'.*kebab case/);
    expect(() =>
      defineLintPlugin({
        name: "acme",
        rules: [{ ...probeRule(), name: "served_at" }],
      }),
    ).toThrow(/'served_at'.*kebab case/);
  });

  test("the core name is reserved", () => {
    expect(() => defineLintPlugin({ name: "seampact", rules: [] })).toThrow(/reserved/);
  });

  test("a rule declared twice is refused", () => {
    const rule = probeRule();

    expect(() => defineLintPlugin({ name: "acme", rules: [rule, rule] })).toThrow(/'probe' twice/);
  });

  test("a plugin given twice is refused", async () => {
    const plugin = probePlugin([]);

    await expect(runLint(lintInputOf(api, [plugin, plugin]))).rejects.toThrow(
      /'test' is given twice/,
    );
  });

  test("a rule that throws is rethrown with its id and the cause", async () => {
    const cause = new Error("boom");
    const plugin = defineLintPlugin({
      name: "test",
      rules: [
        {
          name: "probe",
          defaultSeverity: "warning",
          reports: "x",
          silencedOn: "y",
          check() {
            throw cause;
          },
        },
      ],
    });
    let thrown: unknown;

    try {
      await runLint(lintInputOf(api, [plugin]));
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) throw new Error("the rule's error was not rethrown");
    expect(thrown.message).toBe("the lint rule 'test/probe' threw: boom");
    expect(thrown.cause).toBe(cause);
  });

  test("an async rule's findings are reported once it settles", async () => {
    const plugin = defineLintPlugin({
      name: "test",
      rules: [
        {
          ...probeRule(),
          async check({ report }) {
            await Promise.resolve();
            report(findingAt(ALPHA));
          },
        },
      ],
    });

    expect(rulesOf(await lintedWith(NO_LINT, plugin))).toEqual(["warning test/probe"]);
  });

  test("a rule whose check rejects is an error naming the plugin and the rule", async () => {
    const plugin = defineLintPlugin({
      name: "test",
      rules: [
        {
          ...probeRule(),
          async check() {
            await Promise.resolve();

            throw new Error("the registry is down");
          },
        },
      ],
    });
    const [diagnostic, ...others] = await lintedWith(NO_LINT, plugin);

    expect(others).toEqual([]);
    expect(diagnostic).toEqual({
      severity: "error",
      rule: "test/probe",
      message: "The lint rule 'test/probe' of plugin 'test' failed: the registry is down",
      fix: "Fix the rule in plugin 'test', or set 'test/probe' to disabled in lint.rules.",
      origin: api.ir.api.origin,
      related: [],
    });
  });

  test("a default severity outside the three values is refused", () => {
    const rule = { ...probeRule(), defaultSeverity: "warn" };

    expect(() => lintAssertPlugin({ name: "acme", rules: [rule] })).toThrow(
      /'probe' of plugin 'acme' has the default severity 'warn'/,
    );
  });

  test("a finding the side table cannot locate is a defect of the rule", async () => {
    const missing: Origin = { layer: "api", pointer: "/surfaces/nowhere" };

    await expect(lintedWith(NO_LINT, probePlugin([missing]))).rejects.toThrow(
      /'test\/probe'.*'api#\/surfaces\/nowhere'.*lacks/,
    );
  });

  test("a finding at a core origin or a relay copy is refused", async () => {
    const core: Origin = { layer: "core", pointer: "/errors/api.not_found" };
    const relayed: Origin = { ...ALPHA, api: "other" };

    await expect(lintedWith(NO_LINT, probePlugin([core]))).rejects.toThrow(/core origin/);
    await expect(lintedWith(NO_LINT, probePlugin([relayed]))).rejects.toThrow(/relay copy/);
  });

  test("diagnostics are sorted by file, line, column and rule", async () => {
    const diagnostics = await lintedWith(NO_LINT, probePlugin([BETA, ALPHA, SCHEME]));

    expect(diagnostics.map((d) => d.origin.pointer)).toEqual([
      SCHEME.pointer,
      ALPHA.pointer,
      BETA.pointer,
    ]);
  });
});
