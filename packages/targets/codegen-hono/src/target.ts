import type { Target } from "@seampact/codegen-core";
import { nodeServerTarget } from "@seampact/codegen-core/node-server";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { honoModuleSource } from "./hono-module.js";

// The Hono target, as the CLI loads it. Its placement is a checked source of this package one directory above both
// `src` and `dist`, the `hono` module of each api, and the Web-standard profile of the shared runtime.
export const target: Target = nodeServerTarget({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  format,
  placement: {
    runtimeModule: "hono-boundary",
    runtimeSourceUrl: new URL("../runtime/hono-boundary.ts", import.meta.url),
    frameworkModule: "hono",
    frameworkSource: honoModuleSource,
    runtimeProfile: "web",
  },
});
