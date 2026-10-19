// One boot of the sample app, in a process of its own, for the boot profile: starts the server the overlay builds
// with the variant of `SEAMPACT_SUITE_BOOT_VARIANT`, writes the started line and stops it. A boot check that
// refuses throws, so the process exits with the error and its diagnostic.
import { BOOT_STARTED_LINE } from "@seampact/http-suite";
import { startServer } from "./server.mjs";

const server = await startServer();

console.log(BOOT_STARTED_LINE);
await server.close();
// A framework may keep a handle open after its server closes; the boot is over either way.
process.exit(0);
