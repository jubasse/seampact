// The tasks entry's `nativeDocs` on the assembled Django Ninja consumer: Ninja's `/openapi.json` holds each tasks
// operation with the operation object of seampact's `full` document, which `seampact generate` wrote into the app.
import { describeNativeDocsCheck } from "../../../python/native-docs-check.ts";
import { ninjaApp, startNinjaApp } from "./ninja-app.ts";

describeNativeDocsCheck({
  target: "ninja",
  environmentPrefix: "SEAMPACT_NINJA",
  appOf: ninjaApp,
  start: startNinjaApp,
  documentPath: "/openapi.json",
});
