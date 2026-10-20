import type { Target } from "@seampact/codegen-core";
import { nodeServerTarget } from "@seampact/codegen-core/node-server";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { ajvOwnValidators } from "./ajv/index.js";
import { fastifyModuleSource } from "./fastify-module.js";

// The Fastify target, as the CLI loads it. Its placement is a checked source of this package one directory above both
// `src` and `dist`, and the `fastify` module of each api; with no `validators` link it writes Ajv validators itself.
export const target: Target = nodeServerTarget({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  format,
  placement: {
    runtimeModule: "fastify-boundary",
    runtimeSourceUrl: new URL("../runtime/fastify-boundary.ts", import.meta.url),
    frameworkModule: "fastify",
    frameworkSource: fastifyModuleSource,
    ownValidators: ajvOwnValidators,
  },
  validatorStyles: serverTargetCompatibility(packageJson.name).validatorStyles,
  frameworkDocsOffFix: "remove the `@fastify/swagger` registration",
});
