// One boot of the sample app, in a process of its own, for the boot profile: starts the server the overlay builds
// with the variant of `SEAMPACT_SUITE_BOOT_VARIANT`, writes the started line and stops it. A boot check that
// refuses throws, so the process exits with the error and its diagnostic. The `allow-listed-framework-route`
// variant loads the generated server whose config allow-lists its route, in place of `generated/server`.
import { register } from "node:module";
import { BOOT_STARTED_LINE } from "@seampact/http-suite";
import { ALLOW_LISTED_SERVER_DIRECTORY, bootVariantIs } from "../src/boot-variant.mjs";

const GENERATED_SERVER_DIRECTORY = "/generated/server/";

if (bootVariantIs("allow-listed-framework-route")) {
  register(`data:text/javascript,${encodeURIComponent(serverRedirectHooks())}`);
}

const { startServer } = await import("./server.mjs");
const server = await startServer();

console.log(BOOT_STARTED_LINE);
await server.close();
// A framework may keep a handle open after its server closes; the boot is over either way.
process.exit(0);

// A module hook that resolves every module of the generated server from the allow-listed server's directory.
function serverRedirectHooks(): string {
  const from = JSON.stringify(GENERATED_SERVER_DIRECTORY);
  const to = JSON.stringify(`/${ALLOW_LISTED_SERVER_DIRECTORY}/`);

  return `export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);

  return { ...resolved, url: resolved.url.replace(${from}, ${to}) };
}`;
}
