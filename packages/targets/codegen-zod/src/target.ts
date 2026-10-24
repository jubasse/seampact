import { defineTarget, type Target } from "@seampact/codegen-core";
import {
  parseValidatorsOptions,
  planValidatorsLayout,
  type ValidatorsOptions,
  validatorsDescriptor,
} from "@seampact/codegen-core/validators";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { generateValidators, VALIDATORS_ARTEFACT, type ValidatorsArtefact } from "./generate.js";
import { ZOD_VALIDATOR_STYLE } from "./layout.js";

// The zod validators target, as the CLI loads it.
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
    provides: { validators: { style: ZOD_VALIDATOR_STYLE } },
  },
  format,
  parseOptions: parseValidatorsOptions,
  generate: generateValidators,
  describe(ir) {
    const planned = planValidatorsLayout(ir);

    if (planned.status === "refused") return planned;

    return {
      status: "described",
      descriptors: {
        validators: validatorsDescriptor(ir, planned.layout, ZOD_VALIDATOR_STYLE),
      },
    };
  },
});
