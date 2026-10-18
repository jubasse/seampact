import { defineTarget, type Target } from "@seampact/codegen-core";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { BOUNDARY_ARTEFACT, type BoundaryArtefact, generateBoundary } from "./generate.js";
import { type NestjsOptions, parseNestjsOptions } from "./options.js";

// The NestJS target, as the CLI loads it. It reads the operation types through the `types` link and the input
// validators through the `validators` link, and provides nothing.
export const target: Target = defineTarget<NestjsOptions, BoundaryArtefact, "types" | "validators">(
  {
    metadata: {
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      irSupport: {
        irVersions: [IR_VERSION],
        irRevision: IR_REVISION,
        kinds: ["httpOperation"],
        features: [],
      },
      artefacts: [{ id: BOUNDARY_ARTEFACT, defaultOn: true }],
      consumes: {
        types: { styles: ["typescript"] },
        validators: { styles: ["standard-schema"] },
      },
      provides: {},
    },
    format,
    parseOptions: parseNestjsOptions,
    generate: generateBoundary,
  },
);
