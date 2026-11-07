import {
  operationType,
  planForms,
  propertyKey,
  type QueryOperation,
  type QueryPlan,
} from "@seampact/codegen-core";
import {
  mutationOptionsParameter,
  reactiveOptionsParameter,
} from "../composable-options-parameters.js";
import { PINIA_COLADA_MODULE, refreshesResource } from "./queries-module.js";

// The `composables.ts` of one api for Pinia Colada (ADR 0021 "The generated API"): `create<Api>Composables` returns
// the members of `create<Api>Queries` plus a `use*` composable over each options factory. A query composable takes
// its request and options as a value, a `ref` or a getter, and reads again when they change; a mutation composable
// that refreshes a resource injects the app's query cache, so it runs where `inject` works, as every composable does.

/** The source of `composables.ts`; `imports` holds the specifiers of the client and the queries module. */
export function composablesModuleSource(
  plan: QueryPlan,
  options: { readonly invalidate: "resource" | "off" },
  imports: { readonly client: string; readonly queries: string },
): string {
  const api = plan.apiName;
  const forms = planForms(plan);
  const injectsCache = plan.operations.some((operation) => refreshesResource(operation, options));
  const coladaNames = [
    ...(forms.infinite ? ["useInfiniteQuery"] : []),
    ...(forms.mutation ? ["useMutation"] : []),
    ...(forms.query ? ["useQuery"] : []),
    ...(injectsCache ? ["useQueryCache"] : []),
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
  const composables = plan.operations.flatMap((operation) =>
    composableSources(operation, api, options),
  );

  return [
    [
      `import { ${coladaNames.join(", ")} } from "${PINIA_COLADA_MODULE}";`,
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

function composableSources(
  operation: QueryOperation,
  api: string,
  options: { readonly invalidate: "resource" | "off" },
): string[] {
  const { names } = operation;
  const types = operationType(operation, api);

  if (operation.form === "mutation") {
    const cacheArgument = refreshesResource(operation, options) ? "useQueryCache(), " : "";

    return [
      `${propertyKey(names.hook)}: <OnMutateResult extends Record<string, unknown> = Record<never, never>>(${mutationOptionsParameter(operation, `MutationCallerOptions<${types}, OnMutateResult>`)}) => useMutation(queries.${names.options}(${cacheArgument}options)),`,
    ];
  }

  const request = `request: MaybeRefOrGetter<${types}["request"]>`;
  const plain = `${propertyKey(names.hook)}: (${request}, ${reactiveOptionsParameter(operation, `QueryCallerOptions<${types}>`)}) => useQuery(() => queries.${names.options}(toValue(request), toValue(options))),`;
  const { infinite } = names;

  if (infinite === undefined) return [plain];

  return [
    plain,
    `${propertyKey(infinite.hook)}: (${request}, ${reactiveOptionsParameter(operation, `InfiniteQueryCallerOptions<${types}>`)}) => useInfiniteQuery(() => queries.${infinite.options}(toValue(request), toValue(options))),`,
  ];
}
