// Runs the shared http suite's `default`, `hand-written` and `boot` profiles against the assembled DRF consumer, served
// by the server SEAMPACT_DRF_SERVER names; a boot imports the app's WSGI or ASGI module, whose handler runs the boot
// check. The app directories, the virtual environment and the report directory come from SEAMPACT_DRF_APP,
// SEAMPACT_DRF_ALLOW_LISTED_APP, SEAMPACT_DRF_ROUTE_CHECK_OFF_APP, SEAMPACT_DRF_HOOK_CHECK_OFF_APP, SEAMPACT_DRF_VENV
// and SEAMPACT_DRF_REPORTS.
import { join } from "node:path";
import { describePythonHttpSuite } from "../../../python/python-http-suite.ts";
import { drfApp, drfServerOf, moduleServedBy, startDrfApp } from "./drf-app.ts";
import { DRF_SUITE_REFUSALS } from "./suite-refusals.ts";

const server = drfServerOf(process.env.SEAMPACT_DRF_SERVER);

describePythonHttpSuite({
  target: "drf",
  environmentPrefix: "SEAMPACT_DRF",
  appOf: (appDirectory, venv) => drfApp(appDirectory, venv, server),
  start: (app) => startDrfApp(app, server),
  bootArguments: [
    join(import.meta.dirname, "../../../python/django_boot.py"),
    moduleServedBy(server),
  ],
  refusals: DRF_SUITE_REFUSALS,
});
