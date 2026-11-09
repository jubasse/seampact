import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  type ClassValidatorCalls,
  classValidatorAdapter,
  classValidatorRefusals,
} from "./class-validator-rules.js";
import type { ContractApi, ContractRoute, StandardValidator } from "./contract-route.js";
import { INPUT_RULE_ADAPTERS, vinePathPointer } from "./input-rule-libraries.js";
import { inputRulesProblems } from "./input-rules.js";

const ZOD_VALIDATOR: StandardValidator = z.object({});
const BODY_RULE = z.object({ end: z.string() });

function route(id: string, shape: Partial<ContractRoute> = {}): ContractRoute {
  return {
    id,
    method: "post",
    path: `/v1/${id}`,
    safe: false,
    access: { kind: "public" },
    scopes: [],
    requires: [],
    fieldRights: [],
    params: { path: [], query: [], headers: [] },
    input: { media: "application/json", limitBytes: 1024, rawBody: false },
    validator: ZOD_VALIDATOR,
    responses: [],
    errors: {},
    ...shape,
  };
}

function apiOf(routes: readonly ContractRoute[], shape: Partial<ContractApi> = {}): ContractApi {
  return {
    id: "tasks",
    generatorVersion: "1.0.0",
    basePaths: ["/v1"],
    format: {
      media: "application/json",
      body: { kind: "literal", value: {} },
      codeMember: "code",
      mergeParams: true,
    },
    routes,
    shapes: {},
    frameworkRoutes: { status: "off" },
    hookCheck: "error",
    compression: "off",
    frameworkEtag: "strip",
    catchAll: true,
    ...shape,
  };
}

describe("the boot check of inputRules (ADR 0028 section 6)", () => {
  test("rules for an unknown or filtered-out operation are refused with the api's operations", () => {
    const problems = inputRulesProblems(apiOf([route("scheduleTask")]), {
      scheduleTsk: { body: BODY_RULE },
    });

    expect(problems).toEqual([
      expect.objectContaining({
        problem: expect.stringContaining("'scheduleTsk'"),
        fix: "use one of scheduleTask",
      }),
    ]);
  });

  test("the fix of a large api lists ten operations and counts the others", () => {
    const routes = Array.from({ length: 12 }, (_, index) => route(`operation${index}`));
    const [problem] = inputRulesProblems(apiOf(routes), { missing: {} });

    expect(problem?.fix).toBe(
      `use one of ${routes
        .slice(0, 10)
        .map((each) => each.id)
        .join(", ")}, or one of the 2 others`,
    );
  });

  test("rules for a part the operation takes no input in are refused", () => {
    const problems = inputRulesProblems(apiOf([route("scheduleTask")]), {
      scheduleTask: { query: BODY_RULE },
    });

    expect(problems).toEqual([
      expect.objectContaining({
        operation: "scheduleTask",
        problem: expect.stringContaining("'query'"),
      }),
    ]);
  });

  test("rules on a relay operation are refused with its public operation", () => {
    const problems = inputRulesProblems(
      apiOf([route("scheduleTask", { relays: "publicScheduleTask" })]),
      { scheduleTask: { body: BODY_RULE } },
    );

    expect(problems).toEqual([
      expect.objectContaining({
        operation: "scheduleTask",
        problem: expect.stringContaining("'publicScheduleTask'"),
      }),
    ]);
  });

  test("a value of another library is refused", () => {
    const problems = inputRulesProblems(apiOf([route("scheduleTask")]), {
      scheduleTask: { body: (value: unknown) => value !== null },
    });

    expect(problems).toEqual([
      expect.objectContaining({ problem: "its 'body' rules are not a zod schema of the part" }),
    ]);
  });

  test("well-formed rules give no problem", () => {
    expect(
      inputRulesProblems(apiOf([route("scheduleTask")]), { scheduleTask: { body: BODY_RULE } }),
    ).toEqual([]);
  });

  test("class-validator rules on an api generated without the calls ask for a new generation", () => {
    const classValidatorSchema = {
      "~standard": { vendor: "seampact-class-validator", validate: () => ({ value: {} }) },
    };
    const classValidatorRoute = route("scheduleTask", { validator: classValidatorSchema });
    const problems = inputRulesProblems(apiOf([classValidatorRoute]), {
      scheduleTask: { body: class ScheduleTaskRules {} },
    });

    expect(problems).toEqual([
      expect.objectContaining({ fix: expect.stringContaining("generate the api again") }),
    ]);
  });
});

describe("class-validator rules", () => {
  class ScheduleTaskRules {}

  class Unconstrained {}

  const calls: ClassValidatorCalls = {
    plainToInstance: (_rule, plain) =>
      typeof plain === "object" && plain !== null ? { ...plain } : {},
    validate: async () => [
      { property: "end", constraints: { endAfterStart: "" } },
      {
        property: "items",
        children: [
          { property: "0", children: [{ property: "end", constraints: { customValidation: "" } }] },
        ],
      },
    ],
    getMetadataStorage: () => ({
      getTargetValidationMetadatas: (rule) => (rule === ScheduleTaskRules ? [{}] : []),
    }),
    options: { input: {}, transform: {} },
  };

  test("each constraint gives its property's pointer and its name; an unnamed one gives none", async () => {
    await expect(
      classValidatorAdapter(calls).refusals(ScheduleTaskRules, { end: "2026-01-01" }),
    ).resolves.toEqual([
      { pointer: "/end", name: "endAfterStart" },
      { pointer: "/items/0/end", name: undefined },
    ]);
  });

  test("an error without a property points at its parent", () => {
    expect(classValidatorRefusals([{ constraints: { windowTooLong: "" } }])).toEqual([
      { pointer: "", name: "windowTooLong" },
    ]);
  });

  test("accepts a class with class-validator metadata only", () => {
    const adapter = classValidatorAdapter(calls);

    expect(adapter.accepts(ScheduleTaskRules)).toBe(true);
    expect(adapter.accepts(Unconstrained)).toBe(false);
    expect(adapter.accepts(BODY_RULE)).toBe(false);
  });
});

describe("VineJS rules", () => {
  const adapter = INPUT_RULE_ADAPTERS.vinejs;

  // A VineJS validator as `vine.create` returns it: it reports through the error reporter its options give, then
  // throws that reporter's error.
  function vineValidator(reports: readonly { readonly rule: string; readonly path: string }[]) {
    return {
      "~standard": { vendor: "vinejs" },
      errorReporter: () => undefined,
      messagesProvider: {},
      async validate(_data: unknown, options: { errorReporter: () => VineReporter }) {
        const reporter = options.errorReporter();

        for (const report of reports) {
          reporter.report("refused", report.rule, { getFieldPath: () => report.path });
        }

        if (reporter.hasErrors) throw reporter.createError();

        return _data;
      },
    };
  }

  interface VineReporter {
    readonly hasErrors: boolean;
    report(message: string, rule: string, field: { getFieldPath(): string }): void;
    createError(): Error;
  }

  test("a report gives the field path as a pointer and the reported rule", async () => {
    await expect(
      adapter.refusals(
        vineValidator([
          { rule: "endAfterStart", path: "end" },
          { rule: "windowTooLong", path: "" },
        ]),
        {},
      ),
    ).resolves.toEqual([
      { pointer: "/end", name: "endAfterStart" },
      { pointer: "", name: "windowTooLong" },
    ]);
  });

  test("a passing value gives no refusal", async () => {
    await expect(adapter.refusals(vineValidator([]), {})).resolves.toEqual([]);
  });

  test("an error the validator throws itself rejects with it", async () => {
    const storeDown = new Error("the rule store is down");
    const failing = {
      ...vineValidator([]),
      validate: async () => {
        throw storeDown;
      },
    };

    await expect(adapter.refusals(failing, {})).rejects.toBe(storeDown);
  });

  test("a field path keeps array indices", () => {
    expect(vinePathPointer("items.0.end")).toBe("/items/0/end");
    expect(vinePathPointer("")).toBe("");
  });

  test("accepts a VineJS validator only", () => {
    expect(adapter.accepts(vineValidator([]))).toBe(true);
    expect(adapter.accepts(BODY_RULE)).toBe(false);
  });
});
