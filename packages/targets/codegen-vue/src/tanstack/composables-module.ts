import {
  planForms,
  propertyKey,
  type QueryOperation,
  type QueryPlan,
} from "@seampact/codegen-core";
import {
  mutationOptionsParameter,
  reactiveOptionsParameter,
} from "../composable-options-parameters.js";

// The `composables.ts` of one api for TanStack Query (ADR 0021 "The generated API"): `create<Api>Composables`
// returns the members of `create<Api>Queries` plus a `use*` composable over each options factory. A query
// composable takes its request and options as a value, a `ref` or a getter, and reads again when they change;
// TanStack Query aborts a disposed query's request through its signal and passes no signal to a mutation.

const TANSTACK_MODULE = "@tanstack/vue-query";

/** The source of `composables.ts`; `imports` holds the specifiers of the client and the queries module. */
export function composablesModuleSource(
  plan: QueryPlan,
  imports: { readonly client: string; readonly queries: string },
): string {
  const api = plan.apiName;
  const operations = plan.operations;
  const forms = planForms(plan);
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
    ...(forms.timeout ? ["type WithRequiredCall"] : []),
  ];
  const readsRequests = forms.query || forms.infinite;
  const composables = operations.flatMap((operation) => composableSources(operation, api));

  return [
    [
      `import { ${tanstackNames.join(", ")} } from "${TANSTACK_MODULE}";`,
      ...(readsRequests ? ['import { type MaybeRefOrGetter, toValue } from "vue";'] : []),
      `import type { Client } from "${imports.client}";`,
      `import { ${queriesNames.join(", ")} } from "${imports.queries}";`,
    ].join("\n"),
    `/** The members of \`create${api}Queries\` and a composable per operation; bind the result to a PascalCase name (\`${api}\`). */
export function create${api}Composables(client: Client, settings: ${api}QueriesSettings = {}) {
const queries = create${api}Queries(client, settings);

return {
...queries,
${composables.join("\n\n")}
};
}`,
    `/** What \`create${api}Composables\` returns. */\nexport type ${api}Composables = ReturnType<typeof create${api}Composables>;`,
  ].join("\n\n");
}

function composableSources(operation: QueryOperation, api: string): string[] {
  const { names } = operation;
  const types = `${api}Operations[${JSON.stringify(names.base)}]`;

  if (operation.form === "mutation") {
    return [
      `${propertyKey(names.hook)}: <OnMutateResult = unknown>(${mutationOptionsParameter(operation, `MutationCallerOptions<${types}, OnMutateResult>`)}) => useMutation(queries.${names.options}(options)),`,
    ];
  }

  const request = `request: MaybeRefOrGetter<${types}["request"]>`;
  const plain = `${propertyKey(names.hook)}: <Selected = ${types}["data"]>(${request}, ${reactiveOptionsParameter(operation, `QueryCallerOptions<${types}, Selected>`)}) => useQuery(() => queries.${names.options}(toValue(request), toValue(options))),`;
  const { infinite } = names;

  if (infinite === undefined) return [plain];

  return [
    plain,
    `${propertyKey(infinite.hook)}: <Selected = InfiniteData<${types}["data"], ${types}["request"]>>(${request}, ${reactiveOptionsParameter(operation, `InfiniteQueryCallerOptions<${types}, Selected>`)}) => useInfiniteQuery(() => queries.${infinite.options}(toValue(request), toValue(options))),`,
  ];
}
