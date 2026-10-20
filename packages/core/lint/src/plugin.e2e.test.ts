import { isKnownVariant } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { defineLintPlugin } from "./plugin.js";
import { runLint } from "./run-lint.js";
import { compiledFixtureApi, lintInputOf, rulesOf } from "./test-support.js";

// A house plugin written outside the package runs beside the core rules (SCN-018): no core change.

const servedAt = defineLintPlugin({
  name: "acme",
  rules: [
    {
      name: "served-at",
      defaultSeverity: "warning",
      reports: "a 2xx body without servedAt",
      silencedOn: "the route",
      check({ ir, report }) {
        for (const operation of ir.operations) {
          for (const response of operation.responses) {
            const body = response.body;

            if (response.status < 200 || response.status > 299 || body === undefined) continue;

            if (!isKnownVariant("TypeUse", body) || body.kind !== "ref") continue;
            const schema = ir.schemas[body.schema];

            if (
              schema === undefined ||
              !isKnownVariant("Schema", schema) ||
              schema.kind !== "object"
            )
              continue;

            if (schema.properties.some((property) => property.name === "servedAt")) continue;
            report({
              message: `Route '${operation.id}' answers ${response.status} without servedAt.`,
              fix: `Add servedAt to '${schema.id}'.`,
              origin: operation.origin,
              allowAt: [operation.origin],
            });
          }
        }
      },
    },
  ],
});

test("a house rule runs beside the core rules, takes lint.rules and lint.allow", async () => {
  const api = compiledFixtureApi("plugin");
  const diagnostics = await runLint(lintInputOf(api, [servedAt]));

  expect(rulesOf(diagnostics)).toEqual([
    "warning seampact/credential-name",
    "error acme/served-at",
  ]);
  expect(diagnostics.map((diagnostic) => diagnostic.message)).toContain(
    "Route 'alpha' answers 200 without servedAt.",
  );
});

test("without the plugin the core rules still run and the house settings are reported as ignored", async () => {
  const api = compiledFixtureApi("plugin");

  expect(rulesOf(await runLint(lintInputOf(api)))).toEqual([
    "warning seampact/lint/unclaimed-rule",
    "warning seampact/credential-name",
    "warning seampact/lint/unclaimed-rule",
  ]);
});
