import { expect, test } from "vitest";
import {
  FIRST_PARTY_PROVIDERS,
  firstPartyPackagesOfStyle,
  offeredValidatorPairs,
  SERVER_TARGETS,
  type ValidatorPair,
} from "./index.js";

function pairName(pair: ValidatorPair): string {
  return `${pair.target}@${pair.frameworkMajor}+${pair.validator}`;
}

test("the offered pairs are zod and yup on every server target and major, and class-validator on nestjs", () => {
  expect(offeredValidatorPairs().map(pairName)).toEqual([
    "@seampact/codegen-nestjs@12+zod",
    "@seampact/codegen-nestjs@12+yup",
    "@seampact/codegen-nestjs@12+class-validator",
    "@seampact/codegen-express@4+zod",
    "@seampact/codegen-express@4+yup",
    "@seampact/codegen-express@5+zod",
    "@seampact/codegen-express@5+yup",
    "@seampact/codegen-fastify@5+zod",
    "@seampact/codegen-fastify@5+yup",
    "@seampact/codegen-adonis@6+zod",
    "@seampact/codegen-adonis@6+yup",
    "@seampact/codegen-adonis@7+zod",
    "@seampact/codegen-adonis@7+yup",
    "@seampact/codegen-hono@4+zod",
    "@seampact/codegen-hono@4+yup",
  ]);
});

test("a pair names the framework package and the validator package", () => {
  const nestjsClassValidator = offeredValidatorPairs().find(
    (pair) => pair.validator === "class-validator",
  );

  expect(nestjsClassValidator).toEqual({
    target: "@seampact/codegen-nestjs",
    framework: "@nestjs/core",
    frameworkMajor: 12,
    validator: "class-validator",
    validatorPackage: "@seampact/codegen-class-validator",
  });
});

test("the validators a target generates itself are planned, never offered", () => {
  const plannedValidatorIds = SERVER_TARGETS.flatMap((target) =>
    target.plannedValidators.map((validator) => `${target.package}+${validator.id}`),
  );
  const offeredValidatorIds = new Set(offeredValidatorPairs().map((pair) => pair.validator));

  expect(plannedValidatorIds).toEqual([
    "@seampact/codegen-fastify+ajv",
    "@seampact/codegen-adonis+vinejs",
  ]);
  expect(offeredValidatorIds).not.toContain("ajv");
  expect(offeredValidatorIds).not.toContain("vinejs");
});

test("the packages of a style keep the matrix order", () => {
  expect(firstPartyPackagesOfStyle("standard-schema")).toEqual([
    "@seampact/codegen-zod",
    "@seampact/codegen-yup",
  ]);
  expect(firstPartyPackagesOfStyle("class-validator")).toEqual([
    "@seampact/codegen-class-validator",
  ]);
  expect(firstPartyPackagesOfStyle("typescript")).toEqual(["@seampact/codegen-ts"]);
});

test("provider ids are unique, so a tool can select a provider by id", () => {
  const providerIds = FIRST_PARTY_PROVIDERS.map((provider) => provider.id);

  expect(new Set(providerIds).size).toBe(providerIds.length);
});
