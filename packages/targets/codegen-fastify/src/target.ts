import type { Target } from "@seampact/codegen-core";
import { nodeServerTarget } from "@seampact/codegen-core/node-server";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { ajvOwnValidators } from "./ajv/index.js";
import { fastifyDocsModuleSource } from "./fastify-docs-module.js";
import { fastifyModuleSource } from "./fastify-module.js";

// The Fastify target, as the CLI loads it. Its placement is the `fastify` module of each api, over the Fastify
// placement of `@seampact/server-runtime`; with no `validators` link it writes Ajv validators itself.
export const target: Target = nodeServerTarget({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  format,
  placement: {
    frameworkModule: "fastify",
    compressesReplies: true,
    frameworkSource: fastifyModuleSource,
    nativeDocs: { docsModule: "fastify-docs", docsSource: fastifyDocsModuleSource },
    ownValidators: ajvOwnValidators,
  },
  validatorStyles: serverTargetCompatibility(packageJson.name).validatorStyles,
  frameworkDocsOffFix: "remove the `@fastify/swagger` registration",
});
