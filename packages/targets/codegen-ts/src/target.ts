import { defineTarget, type NoOptions, parseNoOptions, type Target } from "@seampact/codegen-core";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { generateTypes, TYPES_ARTEFACT, type TypesArtefact } from "./generate.js";
import { planTypesLayout, typesDescriptor } from "./layout.js";

// The TypeScript types target, as the CLI loads it.
export const target: Target = defineTarget<NoOptions, TypesArtefact, never, "types">({
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
    artefacts: [{ id: TYPES_ARTEFACT, defaultOn: true }],
    consumes: {},
    provides: { types: { style: "typescript" } },
  },
  format,
  parseOptions: parseNoOptions,
  generate: generateTypes,
  describe(ir) {
    const planned = planTypesLayout(ir);

    if (planned.status === "refused") return planned;

    return { status: "described", descriptors: { types: typesDescriptor(ir, planned.layout) } };
  },
});
