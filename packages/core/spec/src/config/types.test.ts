import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import type { JsonSchema } from "../authoring/schemas.js";
import { APP_CONFIG_SCHEMA, type AppConfig } from "./app-config.js";
import { ROOT_CONFIG_SCHEMA, type RootConfig } from "./root-config.js";

// The types and the schemas describe one config: each typed sample is accepted, and each sample the types refuse
// (`@ts-expect-error`) is refused by the schema too.

function isValid(schema: JsonSchema, value: unknown): boolean {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });

  return ajv.compile(schema)(value) === true;
}

const ACCEPTED_APP_CONFIGS: AppConfig[] = [
  {},
  {
    allowLocal: false,
    outDir: "src/generated",
    sources: {
      orders: { path: "../contracts" },
      billing: { package: "@acme/billing", version: "1.2.0" },
    },
    targets: [
      {
        id: "server",
        use: "@seampact/codegen-express",
        api: "orders",
        artefacts: { nativeDocs: true, boundary: true, bootCheck: { frameworkRoutes: false } },
        allowUntested: ["express@6"],
        link: { validators: "zod" },
      },
      {
        id: "zod",
        use: "@seampact/codegen-zod",
        apis: ["orders"],
        artefacts: { bootCheck: false },
      },
    ],
    openapi: { orders: "docs/orders.yaml" },
    checks: { matrix: "error", openapi: "warning", generated: "disabled" },
    diff: { gate: "both", exempt: ["experimental"] },
  },
];

const REFUSED_APP_CONFIGS: unknown[] = [
  {
    // @ts-expect-error an artefact switch is a boolean
    targets: [{ id: "a", use: "p", api: "x", artefacts: { nativeDocs: "yes" } }],
  } satisfies AppConfig,
  // @ts-expect-error `allowUntested` is a list
  { targets: [{ id: "a", use: "p", api: "x", allowUntested: "express@6" }] } satisfies AppConfig,
  // @ts-expect-error `matrix` has no `disabled`
  { checks: { matrix: "disabled" } } satisfies AppConfig,
  {
    // @ts-expect-error `bootCheck` takes `frameworkRoutes` as a boolean
    targets: [{ id: "a", use: "p", api: "x", artefacts: { bootCheck: { frameworkRoutes: 1 } } }],
  } satisfies AppConfig,
  // @ts-expect-error `apps` belongs to a root config
  { apps: ["web"] } satisfies AppConfig,
];

const ACCEPTED_ROOT_CONFIGS: RootConfig[] = [
  { apps: ["apps/web"] },
  {
    apps: ["apps/web", "apps/api"],
    sources: { orders: { path: "contracts" } },
    allowLocal: true,
    openapi: {
      public: { path: "docs/public.yaml", apps: ["apps/api"], prefix: { orders: "shop" } },
    },
    checks: { openapi: "error" },
  },
];

const REFUSED_ROOT_CONFIGS: unknown[] = [
  // @ts-expect-error a root config lists its apps
  { sources: {} } satisfies RootConfig,
  // @ts-expect-error `targets` belongs to an app config
  { apps: ["web"], targets: [] } satisfies RootConfig,
  // @ts-expect-error a root checks its merged documents only
  { apps: ["web"], checks: { matrix: "error" } } satisfies RootConfig,
];

describe("the app config types and schema", () => {
  test.each(ACCEPTED_APP_CONFIGS)("accept the typed sample %#", (config) => {
    expect(isValid(APP_CONFIG_SCHEMA, config)).toBe(true);
  });

  test.each(REFUSED_APP_CONFIGS)("refuse the sample %# the types refuse", (config) => {
    expect(isValid(APP_CONFIG_SCHEMA, config)).toBe(false);
  });

  test("refuse a malformed `allowUntested` item and an artefact id no DSL can write", () => {
    const entry = { id: "a", use: "p", api: "x" };

    expect(
      isValid(APP_CONFIG_SCHEMA, { targets: [{ ...entry, allowUntested: ["express6"] }] }),
    ).toBe(false);
    expect(
      isValid(APP_CONFIG_SCHEMA, { targets: [{ ...entry, artefacts: { "native-docs": true } }] }),
    ).toBe(false);
  });
});

describe("the root config types and schema", () => {
  test.each(ACCEPTED_ROOT_CONFIGS)("accept the typed sample %#", (config) => {
    expect(isValid(ROOT_CONFIG_SCHEMA, config)).toBe(true);
  });

  test.each(REFUSED_ROOT_CONFIGS)("refuse the sample %# the types refuse", (config) => {
    expect(isValid(ROOT_CONFIG_SCHEMA, config)).toBe(false);
  });
});
