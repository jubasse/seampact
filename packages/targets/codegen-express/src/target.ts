import type { Target } from "@seampact/codegen-core";
import { nodeServerTarget } from "@seampact/codegen-core/node-server";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { expressModuleSource } from "./express-module.js";

// The Express target, as the CLI loads it. Its placement is a checked source of this package one directory above both
// `src` and `dist`, and the `express` module of each api.
export const target: Target = nodeServerTarget({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  format,
  placement: {
    runtimeModule: "express-boundary",
    runtimeSourceUrl: new URL("../runtime/express-boundary.ts", import.meta.url),
    frameworkModule: "express",
    frameworkSource: expressModuleSource,
  },
  validatorStyles: serverTargetCompatibility(packageJson.name).validatorStyles,
});
