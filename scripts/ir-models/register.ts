import { registerHooks } from "node:module";

// `@seampact/spec/ir` exports TypeScript sources whose relative imports name `.js` files. Node strips the
// types but resolves specifiers as written, so this hook maps a `.js` import under `packages/` that does not
// exist to its `.ts` sibling. Load it with `node --import ./scripts/ir-models/register.ts`.

// The repository's own `packages/` directory, so an ancestor directory named `packages` never matches.
const REPOSITORY_PACKAGES_URL = new URL("../../packages/", import.meta.url).href;

function isMissingModule(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND";
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const parentUrl = context.parentURL ?? "";
      const fromPackages = parentUrl.startsWith(REPOSITORY_PACKAGES_URL);

      if (!isMissingModule(error) || !fromPackages || !specifier.endsWith(".js")) throw error;

      return nextResolve(`${specifier.slice(0, -".js".length)}.ts`, context);
    }
  },
});
