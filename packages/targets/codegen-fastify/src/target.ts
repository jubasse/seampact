import type { Target } from "@seampact/codegen-core";
import { nodeServerTarget } from "@seampact/codegen-core/node-server";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { fastifyModuleSource } from "./fastify-module.js";

// The Fastify target, as the CLI loads it. Its placement is a checked source of this package one directory above both
// `src` and `dist`, and the `fastify` module of each api.
export const target: Target = nodeServerTarget({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  format,
  placement: {
    runtimeModule: "fastify-boundary",
    runtimeSourceUrl: new URL("../runtime/fastify-boundary.ts", import.meta.url),
    frameworkModule: "fastify",
    frameworkSource: fastifyModuleSource,
  },
});
