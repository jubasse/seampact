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

function stubNodeServerTarget(validatorStyles?: readonly ValidatorStyle[]) {
  return nodeServerTarget({
    packageName: "@seampact/codegen-stub",
    packageVersion: "1.2.3",
    format,
    placement: {
      runtimeModule: "stub-boundary",
      runtimeSourceUrl: new URL("./stub-boundary.ts", import.meta.url),
      frameworkModule: "stub",
      frameworkSource: () => "",
    },
    ...(validatorStyles === undefined ? {} : { validatorStyles }),
  });
}

test("a class-validator link on a standard-schema consumer is refused, naming codegen-zod and codegen-yup", () => {
  const consumer = stubNodeServerTarget();

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
