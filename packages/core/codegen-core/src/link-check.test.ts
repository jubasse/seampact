import { format } from "prettier";
import { expect, test } from "vitest";
import type { ValidatorStyle } from "./descriptors.js";
import { refuseUnmetLinks } from "./link-check.js";
import type { LinkSet } from "./links.js";
import { nodeServerTarget } from "./node-server/boundary-files.js";

const TYPES_LINK = {
  descriptor: { kind: "types", style: "typescript", schemas: {}, operations: {} },
  location: { kind: "relative", path: "../types" },
} as const;

function linksWithValidatorStyle(style: ValidatorStyle): LinkSet {
  return {
    types: TYPES_LINK,
    validators: {
      descriptor: { kind: "validators", style, schemas: {}, operations: {} },
      location: { kind: "relative", path: "../validators" },
    },
  };
}

// A target the matrix records with its own validators (fastify), whose placement writes none here.
function stubOwnValidatorsTarget() {
  return nodeServerTarget({
    packageName: "@seampact/codegen-fastify",
    packageVersion: "1.2.3",
    format,
    placement: {
      frameworkModule: "stub",
      frameworkSource: () => "",
      ownValidators: () => undefined,
    },
    validatorStyles: ["standard-schema"],
  });
}

function stubNodeServerTarget(validatorStyles: readonly ValidatorStyle[]) {
  return nodeServerTarget({
    packageName: "@seampact/codegen-stub",
    packageVersion: "1.2.3",
    format,
    placement: {
      frameworkModule: "stub",
      frameworkSource: () => "",
    },
    validatorStyles,
  });
}

test("a class-validator link on a standard-schema consumer is refused, naming codegen-zod and codegen-yup", () => {
  const consumer = stubNodeServerTarget(["standard-schema"]);

  const refusals = refuseUnmetLinks(
    consumer.metadata.consumes,
    linksWithValidatorStyle("class-validator"),
  );

  expect(refusals).toEqual([
    {
      code: "link.style.unsupported",
      message:
        "The 'validators' link provides style 'class-validator'; this target reads standard-schema.",
      fix: "Link `@seampact/codegen-zod` or `@seampact/codegen-yup`.",
    },
  ]);
});

test("a missing validators link names the packages of every accepted style", () => {
  const consumer = stubNodeServerTarget(["standard-schema", "class-validator"]);

  const refusals = refuseUnmetLinks(consumer.metadata.consumes, { types: TYPES_LINK });

  expect(refusals.map((refusal) => refusal.fix)).toEqual([
    "Link `@seampact/codegen-zod`, `@seampact/codegen-yup` or `@seampact/codegen-class-validator` in the target's `link` entry.",
  ]);
});

test("a missing validators link of a class-validator-only consumer names codegen-class-validator alone", () => {
  const consumer = stubNodeServerTarget(["class-validator"]);

  const refusals = refuseUnmetLinks(consumer.metadata.consumes, { types: TYPES_LINK });

  expect(refusals.map((refusal) => refusal.fix)).toEqual([
    "Link `@seampact/codegen-class-validator` in the target's `link` entry.",
  ]);
});

test("a node server target with both styles accepts a class-validator link", () => {
  const consumer = stubNodeServerTarget(["standard-schema", "class-validator"]);

  const refusals = refuseUnmetLinks(
    consumer.metadata.consumes,
    linksWithValidatorStyle("class-validator"),
  );

  expect(refusals).toEqual([]);
});

test("an optional need accepts no link and refuses a wrong style", () => {
  const consumer = stubOwnValidatorsTarget();
  const { consumes } = consumer.metadata;

  expect(refuseUnmetLinks(consumes, { types: TYPES_LINK })).toEqual([]);
  expect(refuseUnmetLinks(consumes, linksWithValidatorStyle("standard-schema"))).toEqual([]);
  expect(refuseUnmetLinks(consumes, linksWithValidatorStyle("class-validator"))).toEqual([
    {
      code: "link.style.unsupported",
      message:
        "The 'validators' link provides style 'class-validator'; this target reads standard-schema.",
      fix: "Link `@seampact/codegen-zod` or `@seampact/codegen-yup`, or no `validators` link to use the target's own ajv validators.",
    },
  ]);
});

test("a target without own validators keeps the missing validators link", () => {
  const consumer = stubNodeServerTarget(["standard-schema"]);

  expect(
    refuseUnmetLinks(consumer.metadata.consumes, { types: TYPES_LINK }).map(
      (refusal) => refusal.code,
    ),
  ).toEqual(["link.missing"]);
});

const CLIENT_NEEDS = { client: { styles: ["fetch"] } } as const;

test("a missing client link is refused, naming codegen-fetch", () => {
  expect(refuseUnmetLinks(CLIENT_NEEDS, { types: TYPES_LINK })).toEqual([
    {
      code: "link.missing",
      message: "This target consumes a 'client' link in style fetch, and none is given.",
      fix: "Link `@seampact/codegen-fetch` in the target's `link` entry.",
    },
  ]);
});

test("a fetch client link meets a client need", () => {
  const links: LinkSet = {
    client: {
      descriptor: {
        kind: "client",
        style: "fetch",
        errorStyle: "result",
        exports: {
          createClient: { module: "index", export: "createClient" },
          Client: { module: "index", export: "Client" },
          ContractError: { module: "index", export: "ContractError" },
          CallOptions: { module: "index", export: "CallOptions" },
        },
        operations: {},
      },
      location: { kind: "relative", path: "../client" },
    },
  };

  expect(refuseUnmetLinks(CLIENT_NEEDS, links)).toEqual([]);
});
