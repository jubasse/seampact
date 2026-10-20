import { expect, test } from "vitest";
import {
  FIRST_PARTY_PROVIDERS,
  firstPartyPackagesOfStyle,
  offeredValidatorPairs,
  SERVER_TARGETS,
  serverTargetCompatibility,
  type ValidatorPair,
} from "./index.js";

function pairName(pair: ValidatorPair): string {
  return `${pair.target}@${pair.frameworkMajor}+${pair.validator}`;
}

test("the offered pairs are zod and yup on every server target and major, class-validator on nestjs and the own validators", () => {
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
    "@seampact/codegen-fastify@5+ajv",
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

test("offers each target's own validators", () => {
  const ownValidatorIds = SERVER_TARGETS.flatMap((target) =>
    target.ownValidators.map((validator) => `${target.package}+${validator.id}`),
  );
  const ownPairs = offeredValidatorPairs().filter((pair) => pair.validator === "ajv");

  expect(ownValidatorIds).toEqual(["@seampact/codegen-fastify+ajv"]);
  expect(ownPairs).toEqual([
    {
      target: "@seampact/codegen-fastify",
      framework: "fastify",
      frameworkMajor: 5,
      validator: "ajv",
      validatorPackage: "@seampact/codegen-fastify",
    },
  ]);
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

test("a target package the matrix does not record is refused by name", () => {
  expect(serverTargetCompatibility("@seampact/codegen-hono").framework.supportedMajors).toEqual([
    4,
  ]);
  expect(() => serverTargetCompatibility("@seampact/codegen-stub")).toThrow(
    "compatibility: '@seampact/codegen-stub' is not a server target of the matrix",
  );
});
