// The packages a consumer installs from tarballs, in build order: each is built to `dist/` through its
// `tsconfig.build.json` and packed with its `publishConfig`. A package added to the slice joins this list and
// follows the same manifest form (`files`, and `publishConfig` with `types` and `default` entry points).
export const PACKED_PACKAGES: readonly string[] = [
  "packages/core/spec",
  "packages/runtime/hooks",
  "packages/core/codegen-core",
  "packages/core/compiler",
  "packages/core/cli",
  "packages/targets/codegen-ts",
  "packages/targets/codegen-zod",
  "packages/targets/codegen-fetch",
  "packages/targets/codegen-nestjs",
  "packages/targets/codegen-express",
  "packages/targets/codegen-fastify",
  "packages/targets/codegen-adonis",
  "packages/runtime/signed-webhooks",
  "packages/runtime/idempotency-memory",
];

export const BUILD_CONFIG = "tsconfig.build.json";

export const BUILD_DIRECTORY = "dist";
