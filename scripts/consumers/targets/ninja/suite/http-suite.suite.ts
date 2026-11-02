// Runs the shared http suite's `default`, `hand-written` and `boot` profiles against the assembled Django Ninja
// consumer, served by the server SEAMPACT_NINJA_SERVER names; a boot imports the app's WSGI or ASGI module, whose
// handler runs the boot check. The app directories, the virtual environment and the report directory come from
// SEAMPACT_NINJA_APP, SEAMPACT_NINJA_ALLOW_LISTED_APP, SEAMPACT_NINJA_VENV and SEAMPACT_NINJA_REPORTS.
import { join } from "node:path";
import { moduleServedBy } from "../../../python/django-app.ts";
import { describePythonHttpSuite } from "../../../python/python-http-suite.ts";
import { ninjaApp, ninjaServer, startNinjaApp } from "./ninja-app.ts";
import { NINJA_SUITE_REFUSALS } from "./suite-refusals.ts";

describePythonHttpSuite({
  target: "ninja",
  environmentPrefix: "SEAMPACT_NINJA",
  appOf: ninjaApp,
  start: startNinjaApp,
  bootArguments: [
    join(import.meta.dirname, "../../../python/django_boot.py"),
    moduleServedBy(ninjaServer),
  ],
  refusals: NINJA_SUITE_REFUSALS,
});
