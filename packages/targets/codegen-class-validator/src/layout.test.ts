import { FIRST_PARTY_PROVIDERS } from "@seampact/spec/compatibility";
import { expect, test } from "vitest";
import { CLASS_VALIDATOR_STYLE } from "./layout.js";

test("the style constant equals the compatibility matrix style of @seampact/codegen-class-validator", () => {
  const provider = FIRST_PARTY_PROVIDERS.find(
    (candidate) => candidate.package === "@seampact/codegen-class-validator",
  );

  expect(CLASS_VALIDATOR_STYLE).toBe(provider?.style);
});
