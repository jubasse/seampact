import type { QueryOperation, QueryPlan } from "@seampact/codegen-core";
import { propertyKey } from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";
import { CLIENT_DIRECTIVE } from "../shared/operation-sources.js";

// The `hooks.ts` of one api for TanStack Query (ADR 0021 "The generated API"): `create<Api>Hooks` returns the
// members of `create<Api>Queries` plus a `use*` hook over each options factory. It starts with `"use client"` unless
// the option turns it off. TanStack Query aborts an unmounted query's request through its signal; it passes no
// signal to a mutation.

const TANSTACK_MODULE = "@tanstack/react-query";

/** The source of `hooks.ts`; `imports` holds the specifiers of the client and the queries module. */
export function hooksModuleSource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  imports: { readonly client: string; readonly queries: string },
): string {
  const api = plan.apiName;
  const operations = plan.operations;
  const forms = {
    query: operations.some((operation) => operation.form === "query"),
    infinite: operations.some((operation) => operation.names.infinite !== undefined),
    mutation: operations.some((operation) => operation.form === "mutation"),
  };
  const tanstackNames = [
    ...(forms.infinite ? ["type InfiniteData", "useInfiniteQuery"] : []),
    ...(forms.mutation ? ["useMutation"] : []),
    ...(forms.query ? ["useQuery"] : []),
  ];
  const queriesNames = [
    `create${api}Queries`,
    ...(forms.infinite ? ["type InfiniteQueryCallerOptions"] : []),
    ...(forms.mutation ? ["type MutationCallerOptions"] : []),
    ...(forms.query ? ["type QueryCallerOptions"] : []),
    `type ${api}Operations`,
    `type ${api}QueriesSettings`,
    ...(operations.some((operation) => operation.needsTimeout) ? ["type WithRequiredCall"] : []),
  ];
  const hooks = operations.flatMap((operation) => hookSources(operation, api));

  return [
    ...(options.useClientDirective === "on" ? [CLIENT_DIRECTIVE] : []),
    [
      `import { ${tanstackNames.join(", ")} } from "${TANSTACK_MODULE}";`,
      `import type { Client } from "${imports.client}";`,
      `import { ${queriesNames.join(", ")} } from "${imports.queries}";`,
    ].join("\n"),
    `/** The members of \`create${api}Queries\` and a hook per operation; bind the result to a PascalCase name (\`${api}\`). */
export function create${api}Hooks(client: Client, settings: ${api}QueriesSettings = {}) {
const queries = create${api}Queries(client, settings);

return {
...queries,
${hooks.join("\n\n")}
};
}`,
    `/** What \`create${api}Hooks\` returns. */\nexport type ${api}Hooks = ReturnType<typeof create${api}Hooks>;`,
  ].join("\n\n");
}

function optionsParameter(operation: QueryOperation, type: string): string {
  return operation.needsTimeout ? `options: WithRequiredCall<${type}>` : `options?: ${type}`;
}

function hookSources(operation: QueryOperation, api: string): string[] {
  const { names } = operation;
  const types = `${api}Operations[${JSON.stringify(names.base)}]`;

  if (operation.form === "mutation") {
    return [
      `${propertyKey(names.hook)}: <OnMutateResult = unknown>(${optionsParameter(operation, `MutationCallerOptions<${types}, OnMutateResult>`)}) => useMutation(queries.${names.options}(options)),`,
    ];
  }

  const plain = `${propertyKey(names.hook)}: <Selected = ${types}["data"]>(request: ${types}["request"], ${optionsParameter(operation, `QueryCallerOptions<${types}, Selected>`)}) => useQuery(queries.${names.options}(request, options)),`;
  const { infinite } = names;

  if (infinite === undefined) return [plain];

  return [
    plain,
    `${propertyKey(infinite.hook)}: <Selected = InfiniteData<${types}["data"], ${types}["request"]>>(request: ${types}["request"], ${optionsParameter(operation, `InfiniteQueryCallerOptions<${types}, Selected>`)}) => useInfiniteQuery(queries.${infinite.options}(request, options)),`,
  ];
}
