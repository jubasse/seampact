import { expect, test } from "vitest";
import {
  CLIENT_TARGETS,
  clientTargetCompatibility,
  FIRST_PARTY_PROVIDERS,
  firstPartyPackagesOfStyle,
  JVM_TARGETS,
  offeredValidatorPairs,
  PHP_TARGETS,
  phpTargetOf,
  SERVER_TARGETS,
  serverTargetCompatibility,
  supportedMajorsOf,
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
    "@seampact/codegen-adonis@6+vinejs",
    "@seampact/codegen-adonis@7+zod",
    "@seampact/codegen-adonis@7+yup",
    "@seampact/codegen-adonis@7+vinejs",
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
    consumer: "nestjs",
    validator: "class-validator",
    validatorPackage: "@seampact/codegen-class-validator",
  });
});

test("offers each target's own validators", () => {
  const ownValidatorIds = SERVER_TARGETS.flatMap((target) =>
    target.ownValidators.map((validator) => `${target.package}+${validator.id}`),
  );
  const ownPairs = offeredValidatorPairs().filter(
    (pair) => pair.validator === "ajv" || pair.validator === "vinejs",
  );

  expect(ownValidatorIds).toEqual([
    "@seampact/codegen-fastify+ajv",
    "@seampact/codegen-adonis+vinejs",
  ]);
  expect(ownPairs).toEqual([
    {
      target: "@seampact/codegen-fastify",
      framework: "fastify",
      frameworkMajor: 5,
      consumer: "fastify",
      validator: "ajv",
      validatorPackage: "@seampact/codegen-fastify",
    },
    ...[
      { frameworkMajor: 6, consumer: "adonis6" },
      { frameworkMajor: 7, consumer: "adonis" },
    ].map(({ frameworkMajor, consumer }) => ({
      target: "@seampact/codegen-adonis",
      framework: "@adonisjs/core",
      frameworkMajor,
      consumer,
      validator: "vinejs",
      validatorPackage: "@seampact/codegen-adonis",
    })),
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
  expect(firstPartyPackagesOfStyle("fetch")).toEqual(["@seampact/codegen-fetch"]);
});

test("provider ids are unique, so a tool can select a provider by id", () => {
  const providerIds = FIRST_PARTY_PROVIDERS.map((provider) => provider.id);

  expect(new Set(providerIds).size).toBe(providerIds.length);
});

test("a target package the matrix does not record is refused by name", () => {
  expect(supportedMajorsOf(serverTargetCompatibility("@seampact/codegen-hono"))).toEqual([4]);
  expect(() => serverTargetCompatibility("@seampact/codegen-stub")).toThrow(
    "compatibility: '@seampact/codegen-stub' is not a server target of the matrix",
  );
});

test("each server target records its framework id, its tested majors with their consumer and no incompatible major", () => {
  const frameworks = SERVER_TARGETS.map((target) => ({
    target: target.package,
    id: target.framework.id,
    tested: target.framework.tested.map((tested) => `${tested.major}:${tested.consumer}`),
    incompatible: target.framework.incompatible,
  }));

  expect(frameworks).toEqual([
    { target: "@seampact/codegen-nestjs", id: "nestjs", tested: ["12:nestjs"], incompatible: [] },
    {
      target: "@seampact/codegen-express",
      id: "express",
      tested: ["4:express4", "5:express"],
      incompatible: [],
    },
    { target: "@seampact/codegen-fastify", id: "fastify", tested: ["5:fastify"], incompatible: [] },
    {
      target: "@seampact/codegen-adonis",
      id: "adonis",
      tested: ["6:adonis6", "7:adonis"],
      incompatible: [],
    },
    { target: "@seampact/codegen-hono", id: "hono", tested: ["4:hono"], incompatible: [] },
  ]);
});

test("no framework major is both tested and incompatible", () => {
  const contradictions = SERVER_TARGETS.flatMap(({ package: targetPackage, framework }) =>
    framework.tested
      .filter((tested) => framework.incompatible.some(({ major }) => major === tested.major))
      .map((tested) => `${targetPackage}@${tested.major}`),
  );

  expect(contradictions).toEqual([]);
});

test("every pair carries the consumer overlay of its framework major", () => {
  const consumers = new Set(
    offeredValidatorPairs().map((pair) => `${pair.target}@${pair.frameworkMajor}:${pair.consumer}`),
  );

  expect([...consumers]).toEqual([
    "@seampact/codegen-nestjs@12:nestjs",
    "@seampact/codegen-express@4:express4",
    "@seampact/codegen-express@5:express",
    "@seampact/codegen-fastify@5:fastify",
    "@seampact/codegen-adonis@6:adonis6",
    "@seampact/codegen-adonis@7:adonis",
    "@seampact/codegen-hono@4:hono",
  ]);
});

test("the nestjs and fastify targets record the docs library their nativeDocs artefact imports", () => {
  const libraries = SERVER_TARGETS.flatMap((target) =>
    (target.libraries ?? []).map((library) => ({
      target: target.package,
      id: library.id,
      package: library.package,
      artefact: library.artefact,
      testedMajors: library.testedMajors,
    })),
  );

  expect(libraries).toEqual([
    {
      target: "@seampact/codegen-nestjs",
      id: "nestjs-swagger",
      package: "@nestjs/swagger",
      artefact: "nativeDocs",
      testedMajors: [12],
    },
    {
      target: "@seampact/codegen-fastify",
      id: "fastify-swagger",
      package: "@fastify/swagger",
      artefact: "nativeDocs",
      testedMajors: [9],
    },
  ]);
});

test("the react client row names its fetch link style, React 19 and each query library's tested majors", () => {
  const react = clientTargetCompatibility("@seampact/codegen-react");

  expect(react.clientStyles).toEqual(["fetch"]);
  expect(react.framework.id).toBe("react");
  expect(supportedMajorsOf(react)).toEqual([19]);
  expect(
    react.libraries?.map((library) => `${library.package}@${library.testedMajors.join()}`),
  ).toEqual(["@tanstack/react-query@5", "swr@2", "@reduxjs/toolkit@2", "react-redux@9"]);
  expect(firstPartyPackagesOfStyle("fetch")).toEqual(["@seampact/codegen-fetch"]);
});

test("a client target is not a server target and offers no validator pair", () => {
  expect(() => serverTargetCompatibility("@seampact/codegen-react")).toThrow(/not a server target/);
  expect(() => clientTargetCompatibility("@seampact/codegen-hono")).toThrow(/not a client target/);
  expect(
    offeredValidatorPairs().some((pair) =>
      CLIENT_TARGETS.some((target) => target.package === pair.target),
    ),
  ).toBe(false);
});

test("the spring-boot JVM target is tested on Spring Boot 4 and refuses Spring Boot 2 and 3, apart from the npm targets", () => {
  expect(JVM_TARGETS.map((target) => target.package)).toEqual([
    "io.github.jubasse:seampact-spring-boot",
  ]);
  expect(JVM_TARGETS[0]?.framework.tested.map((tested) => tested.major)).toEqual([4]);
  expect(JVM_TARGETS[0]?.framework.incompatible.map((incompatible) => incompatible.major)).toEqual([
    2, 3,
  ]);
  expect(SERVER_TARGETS.map((target) => target.package)).not.toContain(
    "io.github.jubasse:seampact-spring-boot",
  );
});

test("the laravel PHP target is tested on Laravel 13 and refuses Laravel 11 and 12", () => {
  expect(PHP_TARGETS.map((target) => target.package)).toEqual(["seampact/laravel"]);
  expect(PHP_TARGETS[0]?.framework.tested.map((tested) => tested.major)).toEqual([13]);
  expect(PHP_TARGETS[0]?.framework.incompatible.map((incompatible) => incompatible.major)).toEqual([
    11, 12,
  ]);
});

test("a PHP target's floor is <major>.<minor> of a tested major", () => {
  const row = (floor: string) => ({
    package: "acme/target",
    framework: {
      id: "acme",
      package: "acme/framework",
      tested: [{ major: 7, consumer: "acme" }],
      incompatible: [],
      floor,
    },
  });

  expect(phpTargetOf(row("7.4")).framework.floor).toBe("7.4");

  for (const target of PHP_TARGETS) expect(phpTargetOf(target)).toBe(target);

  expect(() => phpTargetOf(row("6.4"))).toThrow("not <major>.<minor> of a tested major (7)");
  expect(() => phpTargetOf(row("7"))).toThrow("acme/target floor is '7'");
});
