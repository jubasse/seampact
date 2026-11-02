// Runs the shared http suite's `default`, `hand-written` and `boot` profiles against the assembled FastAPI consumer
// served by uvicorn; a boot is a uvicorn start of the app, whose startup runs the boot check. The app directories, the
// virtual environment and the report directory come from SEAMPACT_FASTAPI_APP, SEAMPACT_FASTAPI_ALLOW_LISTED_APP,
// SEAMPACT_FASTAPI_VENV and SEAMPACT_FASTAPI_REPORTS.
import { join } from "node:path";
import { describePythonHttpSuite } from "../../../python/python-http-suite.ts";
import { FASTAPI_APPLICATION, fastApiApp, startFastApiApp } from "./fastapi-app.ts";
import { FASTAPI_SUITE_REFUSALS } from "./suite-refusals.ts";

describePythonHttpSuite({
  target: "fastapi",
  environmentPrefix: "SEAMPACT_FASTAPI",
  appOf: fastApiApp,
  start: (app) => startFastApiApp(app),
  bootArguments: [join(import.meta.dirname, "../../../python/boot.py"), FASTAPI_APPLICATION],
  refusals: FASTAPI_SUITE_REFUSALS,
});
