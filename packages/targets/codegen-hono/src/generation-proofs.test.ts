import { describeGenerationProofs } from "@seampact/codegen-core/node-server/test-support";
import { target } from "./index.js";

describeGenerationProofs({
  target,
  serverOptions: { bodyValidation: true },
  testFileUrl: import.meta.url,
  frameworkFile: "hono.ts",
  registration: "registerRoutes",
});
