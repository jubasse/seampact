import {
  expectedNonPathScopeSourceRefusals,
  FORMS_REFUSED_BY_ONE_ZERO,
  GENERATE_TIMEOUT_MILLISECONDS,
  generateWithRefusedForm,
  generateWithRightsVersionHeader,
  nonPathScopeSourceRefusals,
  projectDirectory,
  referenceLinks,
  referenceServerOutput,
  refusalOf,
  RIGHTS_VERSION_OPERATION,
} from "@seampact/codegen-core/node-server/test-support";
import { beforeAll, describe, expect, test } from "vitest";
import { REFERENCE_API, nextGenerateRequest } from "./generate-request.test-support.js";
import { target } from "./index.js";

const PROJECT = projectDirectory(import.meta.url, "next-forms-refused");

beforeAll(async () => {
  await nextGenerateRequest(PROJECT);
}, GENERATE_TIMEOUT_MILLISECONDS);

// The forms 1.0 refuses by name (`FORMS_REFUSED_BY_ONE_ZERO`): generation refuses, it does not warn.
describe("the forms 1.0 refuses on Next.js", () => {
  test("a scope id read from a source other than the path is refused by name at its source", async () => {
    const refusals = await nonPathScopeSourceRefusals(target, {
      links: await referenceLinks(PROJECT, REFERENCE_API),
      outputDirectory: referenceServerOutput(PROJECT, REFERENCE_API),
    });

    expect(refusals).toEqual(expectedNonPathScopeSourceRefusals());
  });

  test.each(FORMS_REFUSED_BY_ONE_ZERO)("$title is refused by name", async (form) => {
    const outcome = await generateWithRefusedForm(target, form, {
      links: await referenceLinks(PROJECT, REFERENCE_API),
      outputDirectory: referenceServerOutput(PROJECT, REFERENCE_API),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: expect.arrayContaining([expect.objectContaining(refusalOf(form))]),
    });
  });
});

// The rights-version header answers on the response, which no handler can write: generation refuses it by name at
// its declaration rather than drop it.
describe("the rights-version header on Next.js", () => {
  test("is refused by name at generation", async () => {
    const outcome = await generateWithRightsVersionHeader(target, {
      links: await referenceLinks(PROJECT, "tasksService"),
      outputDirectory: referenceServerOutput(PROJECT, "tasksService"),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: expect.arrayContaining([
        expect.objectContaining({
          code: "identity.response.header.unsupported",
          member: "/headers/rightsVersion",
          operation: RIGHTS_VERSION_OPERATION,
        }),
      ]),
    });
  });
});
