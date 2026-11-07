import type { NativeDocsContract } from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";

// The `fastify-docs` module of one api: `contractSwaggerTransformObject`, which writes seampact's operation objects
// and components into the document `@fastify/swagger` builds (ADR 0009 "Artefacts and the compatibility matrix").
// Contract routes carry no route `schema`, so Fastify's own validation and serialisation stay off them (ADR 0017);
// the operation objects are copied from the api's OpenAPI document, never re-derived. The entries `@fastify/swagger`
// builds for the generated routes themselves (positional `{pN}` paths, the base-path wildcards) are removed.

// How `@fastify/swagger` writes the path of a generated route: each placeholder as its position (`fastifyPath` in the
// boundary runtime), a literal `:` single.
function generatedRoutePath(template: string): string {
  let position = 0;

  return template.replace(/\{[^}]+\}/g, () => {
    position += 1;

    return `{p${position}}`;
  });
}

function basePathWildcards(ir: ContractIR): string[] {
  const basePaths = new Set(Object.values(ir.api.surfaces).map((surface) => surface.prefix));

  return [...basePaths].filter((basePath) => basePath !== "").map((basePath) => `${basePath}/{*}`);
}

export function fastifyDocsModuleSource(ir: ContractIR, contract: NativeDocsContract): string {
  const operations = ir.operations.map((operation) => {
    const documented = contract.operations.get(operation.id);

    if (documented === undefined) {
      throw new Error(`The reader passed no document for operation '${operation.id}'.`);
    }

    const { method, path } = documented;

    return `{ method: ${JSON.stringify(method)}, path: ${JSON.stringify(path)}, generatedPath: ${JSON.stringify(generatedRoutePath(path))}, operation: ${JSON.stringify(JSON.stringify(documented.operation))} },`;
  });

  return [
    'import type { SwaggerTransformObject } from "@fastify/swagger";',
    'import { assertOpenApi31, type ComponentSections, mergeComponents } from "./native-docs/contract-document.js";',
    "",
    `const API_ID = ${JSON.stringify(ir.api.id)};`,
    "",
    "// Each operation is JSON text, parsed per call: a fresh object for every document the app writes.",
    "const CONTRACT_OPERATIONS: readonly { method: string; path: string; generatedPath: string; operation: string }[] = [",
    ...operations,
    "];",
    "",
    "// The paths of the routes that answer any method below a base path, which the boundary registers.",
    `const BASE_PATH_WILDCARDS: readonly string[] = ${JSON.stringify(basePathWildcards(ir))};`,
    "",
    `const CONTRACT_COMPONENTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = ${JSON.stringify(contract.components)};`,
    "",
    "/**",
    " * The `transformObject` option of `@fastify/swagger` (dynamic mode, `openapi: { openapi: '3.1.0' }`): replaces the",
    " * entries it built for the api's routes with seampact's operation objects and adds the api's components. Register",
    " * it once per api (compose them with `inner`); `inner` is the app's own `transformObject`, which then runs on the",
    " * result. A component the document already holds with another value throws.",
    " */",
    "export function contractSwaggerTransformObject(inner?: SwaggerTransformObject): SwaggerTransformObject {",
    "  return (documentObject) => {",
    '    if (!("openapiObject" in documentObject)) {',
    `      throw new Error("seampact: the Fastify docs of api '${ir.api.id}' need @fastify/swagger in OpenAPI mode; set openapi: { openapi: '3.1.0' } in its options.");`,
    "    }",
    "",
    "    const { openapiObject } = documentObject;",
    "",
    "    assertOpenApi31(openapiObject.openapi, API_ID);",
    "",
    "    const paths: Record<string, Record<string, unknown> | undefined> = Object.fromEntries(Object.entries(openapiObject.paths ?? {}));",
    "",
    "    for (const { method, generatedPath } of CONTRACT_OPERATIONS) {",
    "      const kept = { ...paths[generatedPath] };",
    "",
    "      delete kept[method];",
    "",
    "      if (Object.keys(kept).length === 0) delete paths[generatedPath];",
    "      else paths[generatedPath] = kept;",
    "    }",
    "",
    "    for (const wildcard of BASE_PATH_WILDCARDS) delete paths[wildcard];",
    "",
    "    for (const { method, path, operation } of CONTRACT_OPERATIONS) {",
    "      paths[path] = { ...paths[path], [method]: JSON.parse(operation) };",
    "    }",
    "",
    "    const held: ComponentSections = Object.fromEntries(Object.entries(openapiObject.components ?? {}));",
    "    const completed = { ...openapiObject, paths, components: mergeComponents(held, CONTRACT_COMPONENTS, API_ID) };",
    "",
    "    return inner === undefined ? completed : inner({ openapiObject: completed });",
    "  };",
    "}",
    "",
  ].join("\n");
}
