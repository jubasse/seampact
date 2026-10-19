import { defineTarget, type Target } from "@seampact/codegen-core";
import {
  BOUNDARY_ARTEFACT,
  type BoundaryArtefact,
  type NodeServerOptions,
  type NodeServerPlacement,
  nodeServerBoundaryFiles,
  parseNodeServerOptions,
} from "@seampact/codegen-core/node-server";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { adonisModuleSource } from "./adonis-module.js";

// The AdonisJS placement: a checked source of this package one directory above both `src` and `dist`, and the
// `adonis` module of each api.
const ADONIS_PLACEMENT: NodeServerPlacement = {
  runtimeModule: "adonis-boundary",
  runtimeSourceUrl: new URL("../runtime/adonis-boundary.ts", import.meta.url),
  frameworkModule: "adonis",
  frameworkSource: adonisModuleSource,
};

// The AdonisJS target, as the CLI loads it. It reads the operation types through the `types` link and the input
// validators through the `validators` link, and provides nothing.
export const target: Target = defineTarget<
  NodeServerOptions,
  BoundaryArtefact,
  "types" | "validators"
>({
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
      validators: { styles: [...serverTargetCompatibility(packageJson.name).validatorStyles] },
    },
    provides: {},
  },
  format,
  parseOptions: parseNodeServerOptions,
  generate: (input) => nodeServerBoundaryFiles(input, ADONIS_PLACEMENT),
});
