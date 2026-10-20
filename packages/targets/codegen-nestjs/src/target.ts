import type { Target } from "@seampact/codegen-core";
import { nodeServerTarget } from "@seampact/codegen-core/node-server";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { nestjsModuleSource } from "./nestjs-module.js";

// The NestJS target, as the CLI loads it. Its placement is a checked source of this package one directory above both
// `src` and `dist`, and the `nestjs` module of each api. It reads the validator
// styles the compatibility matrix records for it, Standard Schema and class-validator.
export const target: Target = nodeServerTarget({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  format,
  placement: {
    runtimeModule: "nestjs-boundary",
    runtimeSourceUrl: new URL("../runtime/nestjs-boundary.ts", import.meta.url),
    frameworkModule: "nestjs",
    frameworkSource: nestjsModuleSource,
  },
  validatorStyles: serverTargetCompatibility(packageJson.name).validatorStyles,
  frameworkDocsOffFix: "remove the `SwaggerModule.setup` call",
});
