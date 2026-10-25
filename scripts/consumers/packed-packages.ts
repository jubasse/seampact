// The packages a consumer installs from tarballs, in build order: each is built to `dist/` through its
// `tsconfig.build.json` and packed with its `publishConfig`. A package added to the slice joins this list and
// follows the same manifest form (`files`, and `publishConfig` with `types` and `default` entry points).
export const PACKED_PACKAGES: readonly string[] = [
  "packages/core/spec",
  "packages/runtime/hooks",
  "packages/core/codegen-core",
  "packages/core/compiler",
  "packages/core/lint",
  "packages/core/diff",
  "packages/core/openapi",
  "packages/core/cli",
  "packages/targets/codegen-ts",
  "packages/targets/codegen-zod",
  "packages/targets/codegen-yup",
  "packages/targets/codegen-class-validator",
  "packages/targets/codegen-fetch",
  "packages/targets/codegen-react",
  "packages/targets/codegen-vue",
  "packages/targets/codegen-angular",
  "packages/targets/codegen-nestjs",
  "packages/targets/codegen-express",
  "packages/targets/codegen-fastify",
  "packages/targets/codegen-hono",
  "packages/targets/codegen-adonis",
  "packages/runtime/signed-webhooks",
  "packages/runtime/idempotency-memory",
  "packages/tools/http-suite",
];

export const BUILD_CONFIG = "tsconfig.build.json";

export const BUILD_DIRECTORY = "dist";

// The first-party convention packs: packed as they are (a `pack.yaml`, no build), so a contract naming
// `packs: ["@seampact/pack-hal"]` compiles in an app right after install. All six ship: they are a few kilobytes
// each, and reading the app's contracts to pick some would add a parser for no saving.
export const PACKED_PACKS: readonly string[] = [
  "packages/packs/pack-api-platform",
  "packages/packs/pack-crud-rights",
  "packages/packs/pack-hal",
  "packages/packs/pack-jsonapi",
  "packages/packs/pack-laravel",
  "packages/packs/pack-spring",
];
