// One sample app started with the variant of `SEAMPACT_SUITE_BOOT_VARIANT`, in a process of its own, serving until
// it is stopped: the HTTP cases that run on a variant app (`variant-app-cases.mts`) send their requests to it.
import { SERVING_LINE_PREFIX } from "./variant-app-cases.mjs";
import { startVariantServer } from "./variant-server.mjs";

const server = await startVariantServer();

process.once("SIGTERM", () => {
  // A framework may keep a handle open after its server closes; the process is over either way.
  server.close().finally(() => process.exit(0));
});
console.log(`${SERVING_LINE_PREFIX}${server.baseUrl}`);
