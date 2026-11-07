// The tasks entry's `nativeDocs` on the assembled FastAPI consumer: FastAPI's `/openapi.json` holds each tasks
// operation with the operation object of seampact's `full` document, which `seampact generate` wrote into the app.
import { describeNativeDocsCheck } from "../../../python/native-docs-check.ts";
import { fastApiApp, startFastApiApp } from "./fastapi-app.ts";

describeNativeDocsCheck({
  target: "fastapi",
  environmentPrefix: "SEAMPACT_FASTAPI",
  appOf: fastApiApp,
  start: startFastApiApp,
  documentPath: "/openapi.json",
});
