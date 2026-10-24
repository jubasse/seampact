import { defineTarget, type Target } from "@seampact/codegen-core";
import {
  parseValidatorsOptions,
  planValidatorsWithinWireNames,
  type ValidatorsOptions,
  validatorsDescriptor,
} from "@seampact/codegen-core/validators";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { generateValidators, VALIDATORS_ARTEFACT, type ValidatorsArtefact } from "./generate.js";
import { YUP_VALIDATOR_STYLE } from "./layout.js";
import { YUP_WIRE_NAME_LIMIT } from "./path-keys.js";

// The yup validators target, as the CLI loads it.
export const target: Target = defineTarget<
  ValidatorsOptions,
  ValidatorsArtefact,
  never,
  "validators"
>({
  metadata: {
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    role: "provider",
    irSupport: {
      irVersions: [IR_VERSION],
      irRevision: IR_REVISION,
      kinds: ["httpOperation"],
      features: [],
    },
    artefacts: [{ id: VALIDATORS_ARTEFACT, defaultOn: true }],
    consumes: {},
    provides: { validators: { style: YUP_VALIDATOR_STYLE } },
  },
  format,
  parseOptions: parseValidatorsOptions,
  generate: generateValidators,
  describe(ir) {
    const planned = planValidatorsWithinWireNames(ir, YUP_WIRE_NAME_LIMIT);

    if (planned.status === "refused") return planned;

    return {
      status: "described",
      descriptors: {
        validators: validatorsDescriptor(ir, planned.plan.layout, YUP_VALIDATOR_STYLE),
      },
    };
  },
});
