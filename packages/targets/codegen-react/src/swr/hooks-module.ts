import type { QueryOperation, QueryPlan } from "@seampact/codegen-core";
import { propertyKey } from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";
import { operationType, planForms } from "../shared/operation-sources.js";

// The `hooks.ts` of one api for SWR (ADR 0021 "SWR"): `create<Api>Hooks` returns the members of
// `create<Api>Queries` plus `use<Op>(request | null, config?)` over `useSWR`, `use<Op>Infinite` over `useSWRInfinite`
// and `use<Op>(config?)` over `useSWRMutation`. A write revalidates its resource's queries through the bound
// `mutate` with a filter on the resource key; SWR's filters skip infinite keys, so the hooks record the key of each
// mounted infinite query by resource and revalidate those by key. SWR passes no abort signal, and `useSWRMutation`
// has no retry: each `trigger` draws a new idempotency key.

const CLIENT_DIRECTIVE = '"use client";';

/** The source of `hooks.ts`; `imports` holds the specifiers of the client, the queries module and the runtime. */
export function hooksModuleSource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  imports: { readonly client: string; readonly queries: string; readonly runtime: string },
): string {
  const api = plan.apiName;
  const operations = plan.operations;
  const forms = planForms(plan);
  const invalidates =
    options.invalidate === "resource" &&
    operations.some((operation) => invalidatesResource(operation, options));
  const tracksInfinite =
    options.invalidate === "resource" &&
    operations.some(
      (operation) => operation.names.infinite !== undefined && operation.resource !== undefined,
    );
  const queriesNames = [
    `create${api}Queries`,
    ...(forms.infinite ? ["type InfiniteCallerConfig"] : []),
    ...(forms.mutation ? ["type MutationCallerConfig", "type MutationKey"] : []),
    ...(forms.query ? ["type QueryCallerConfig"] : []),
    `type ${api}Operations`,
    `type ${api}QueriesSettings`,
    ...(invalidates ? [`type ${api}Resource`] : []),
    ...(forms.timeout ? ["type WithRequiredCall"] : []),
  ];
  const swrNames = [
    ...(forms.query ? ["useSWR"] : []),
    ...(invalidates ? ["type ScopedMutator", "useSWRConfig"] : []),
  ];
  const runtimeNames = [
    ...(invalidates ? ["keyStartsWith"] : []),
    ...(tracksInfinite ? ["MountedKeys"] : []),
  ];
  const setup = [
    `const queries = create${api}Queries(client, settings);`,
    ...(tracksInfinite ? [`const mountedInfinite = new MountedKeys<${api}Resource>();`] : []),
    ...(invalidates ? [revalidateResourceSource(api, tracksInfinite)] : []),
  ];
  const hooks = operations.flatMap((operation) => hookSources(operation, api, options));

  return [
    ...(options.useClientDirective === "on" ? [CLIENT_DIRECTIVE] : []),
    [
      ...(tracksInfinite ? ['import { useEffect } from "react";'] : []),
      ...(swrNames.length === 0 ? [] : [swrImport(swrNames)]),
      ...(forms.infinite
        ? ['import useSWRInfinite, { unstable_serialize } from "swr/infinite";']
        : []),
      ...(forms.mutation ? ['import useSWRMutation from "swr/mutation";'] : []),
      `import type { Client } from "${imports.client}";`,
      `import { ${queriesNames.join(", ")} } from "${imports.queries}";`,
      ...(runtimeNames.length === 0
        ? []
        : [`import { ${runtimeNames.join(", ")} } from "${imports.runtime}";`]),
    ].join("\n"),
    `/** The members of \`create${api}Queries\` and a hook per operation; bind the result to a PascalCase name (\`${api}\`). */
export function create${api}Hooks(client: Client, settings: ${api}QueriesSettings = {}) {
${setup.join("\n\n")}

return {
...queries,
${hooks.join("\n\n")}
};
}`,
    `/** What \`create${api}Hooks\` returns. */\nexport type ${api}Hooks = ReturnType<typeof create${api}Hooks>;`,
  ].join("\n\n");
}

// `useSWR` is the default export; the other names are named exports of the same module.
function swrImport(names: readonly string[]): string {
  const named = names.filter((name) => name !== "useSWR");
  const defaultName = names.includes("useSWR") ? "useSWR" : "";
  const namedPart = named.length === 0 ? "" : `{ ${named.join(", ")} }`;
  const parts = [defaultName, namedPart].filter((part) => part !== "");

  return `import ${parts.join(", ")} from "swr";`;
}

function revalidateResourceSource(api: string, tracksInfinite: boolean): string {
  const infiniteKeys = tracksInfinite
    ? ", ...mountedInfinite.keysOf(type).map((key) => mutate(key))"
    : "";

  return `// Revalidates the queries of a resource: the filter reaches the plain keys, the recorded keys the infinite queries.
const revalidateResource = async (mutate: ScopedMutator, type: ${api}Resource): Promise<void> => {
const prefix = queries.keys.resource(type);

await Promise.all([mutate((key) => keyStartsWith(key, prefix))${infiniteKeys}]);
};`;
}

function invalidatesResource(operation: QueryOperation, options: ReactQueryOptions): boolean {
  return (
    operation.form === "mutation" &&
    options.invalidate === "resource" &&
    operation.resource !== undefined
  );
}

// The caller config parameter and how the hook takes `call` out of it.
function configParameter(operation: QueryOperation, type: string): string {
  return operation.needsTimeout ? `config: WithRequiredCall<${type}>` : `config?: ${type}`;
}

function configRead(operation: QueryOperation): string {
  return operation.needsTimeout
    ? "const { call, ...swrConfig } = config;"
    : "const { call, ...swrConfig } = config ?? {};";
}

function hookSources(operation: QueryOperation, api: string, options: ReactQueryOptions): string[] {
  if (operation.form === "mutation") return [mutationHookSource(operation, api, options)];

  const plain = queryHookSource(operation, api);

  return operation.names.infinite === undefined
    ? [plain]
    : [plain, infiniteHookSource(operation, api, options)];
}

function queryHookSource(operation: QueryOperation, api: string): string {
  const { names } = operation;
  const types = operationType(operation, api);

  return `${propertyKey(names.hook)}: (request: ${types}["request"] | null, ${configParameter(operation, `QueryCallerConfig<${types}>`)}) => {
${configRead(operation)}
const options = request === null ? undefined : queries.${names.options}(request, call);

return useSWR<${types}["data"], ${types}["error"]>(options === undefined ? null : options.key, options === undefined ? null : options.fetcher, swrConfig);
},`;
}

function infiniteHookSource(
  operation: QueryOperation,
  api: string,
  options: ReactQueryOptions,
): string {
  const { names, resource } = operation;
  const infinite = names.infinite;

  if (infinite === undefined) return "";

  const types = operationType(operation, api);
  const tracked = options.invalidate === "resource" && resource !== undefined;
  const track = tracked
    ? `const infiniteKey = options === undefined ? undefined : unstable_serialize(options.getKey);

useEffect(() => (infiniteKey === undefined ? undefined : mountedInfinite.add(${JSON.stringify(resource)}, infiniteKey)), [infiniteKey]);

`
    : "";

  return `${propertyKey(infinite.hook)}: (request: ${types}["request"] | null, ${configParameter(operation, `InfiniteCallerConfig<${types}>`)}) => {
${configRead(operation)}
const options = request === null ? undefined : queries.${infinite.options}(request, call);

${track}return useSWRInfinite<${types}["data"], ${types}["error"]>(options === undefined ? () => null : options.getKey, options === undefined ? null : options.fetcher, swrConfig);
},`;
}

function mutationHookSource(
  operation: QueryOperation,
  api: string,
  options: ReactQueryOptions,
): string {
  const { names, resource } = operation;
  const types = operationType(operation, api);
  const generics = `${types}["data"], ${types}["error"], MutationKey, ${types}["request"]`;

  if (!invalidatesResource(operation, options) || resource === undefined) {
    return `${propertyKey(names.hook)}: (${configParameter(operation, `MutationCallerConfig<${types}>`)}) => {
${configRead(operation)}
const options = queries.${names.options}(call);

return useSWRMutation<${generics}>(options.key, options.fetcher, swrConfig);
},`;
  }

  return `${propertyKey(names.hook)}: (${configParameter(operation, `MutationCallerConfig<${types}>`)}) => {
${configRead(operation)}
const { mutate } = useSWRConfig();
const options = queries.${names.options}(call);

return useSWRMutation<${generics}>(
options.key,
async (key, extra) => {
const data = await options.fetcher(key, extra);

await revalidateResource(mutate, ${JSON.stringify(resource)});

return data;
},
swrConfig,
);
},`;
}
