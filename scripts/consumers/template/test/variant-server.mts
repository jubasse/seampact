// Starts the server the overlay builds with the boot variant of `SEAMPACT_SUITE_BOOT_VARIANT`, for a process of its
// own: a variant built from another entry of the config (`variantServerRedirect`) loads that entry's generated server
// modules in place of `generated/server`'s.
import { register } from "node:module";
import { type ServerRedirect, variantServerRedirect } from "../src/boot-variant.mjs";
import type { RunningServer } from "./server.mjs";

export async function startVariantServer(): Promise<RunningServer> {
  const serverRedirect = variantServerRedirect();

  if (serverRedirect !== undefined) {
    register(`data:text/javascript,${encodeURIComponent(serverRedirectHooks(serverRedirect))}`);
  }

  const { startServer } = await import("./server.mjs");

  return startServer();
}

// A module hook that resolves every module under the redirect's `from` directory from its `to` directory.
function serverRedirectHooks(redirect: ServerRedirect): string {
  const from = JSON.stringify(`/${redirect.from}/`);
  const to = JSON.stringify(`/${redirect.to}/`);

  return `export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);

  return { ...resolved, url: resolved.url.replace(${from}, ${to}) };
}`;
}
