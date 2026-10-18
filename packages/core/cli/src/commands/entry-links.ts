import type { Target } from "@seampact/codegen-core";
import type { TargetEntry } from "@seampact/spec/config";
import type { ContractIR } from "@seampact/spec/ir";
import { type CliProblem, entryWhere } from "../cli-problem.js";

// The link checks the CLI owns (ADR 0009 "The provider seam"), each naming the consumer and the provider entry,
// and the order that runs every provider before its consumers.

// One api of an entry, as `generate` runs it: the filtered IR and the directory its files go to.
export interface PlannedApi {
  api: string;
  source: string;
  ir: ContractIR;
  root: string;
}

export interface PlannedEntry {
  entry: TargetEntry;
  target: Target;
  apis: readonly PlannedApi[];
}

export function linksOf(entry: TargetEntry): [kind: string, providerId: string][] {
  return Object.entries(entry.link ?? {});
}

function linkWhere(consumerId: string, providerId: string, api?: string): string {
  const apiText = api === undefined ? "" : `, api '${api}'`;

  return `entry '${consumerId}' linked to '${providerId}'${apiText}`;
}

// A `link` value that names no entry of the config.
export function unknownLinkEntryProblems(entries: readonly TargetEntry[]): CliProblem[] {
  const ids = new Set(entries.map((entry) => entry.id));

  return entries.flatMap((entry) =>
    linksOf(entry)
      .filter(([, providerId]) => !ids.has(providerId))
      .map(([kind, providerId]) => ({
        code: "link.entry.unknown",
        message: `The '${kind}' link names '${providerId}', and no target entry has that id.`,
        fix: "Name the id of the target entry that provides the link.",
        where: linkWhere(entry.id, providerId),
      })),
  );
}

export type EntryOrderOutcome =
  | { status: "ordered"; entries: TargetEntry[] }
  | { status: "refused"; problems: CliProblem[] };

// The entries with every provider before its consumers, in config order otherwise; a link cycle is refused,
// naming its entries. Assumes every link names a known entry.
export function orderEntries(entries: readonly TargetEntry[]): EntryOrderOutcome {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ordered: TargetEntry[] = [];
  const done = new Set<string>();
  const visiting: string[] = [];

  function visit(entry: TargetEntry): CliProblem | undefined {
    if (done.has(entry.id)) return undefined;

    const cycleStart = visiting.indexOf(entry.id);

    if (cycleStart !== -1) {
      const cycle = [...visiting.slice(cycleStart), entry.id];

      return {
        code: "link.cycle",
        message: `The links form a cycle: ${cycle.map((id) => `'${id}'`).join(" -> ")}.`,
        fix: "Remove one of these links: a provider cannot consume what its consumer generates.",
        where: entryWhere(entry.id),
      };
    }

    visiting.push(entry.id);

    for (const [, providerId] of linksOf(entry)) {
      const provider = byId.get(providerId);
      const problem = provider === undefined ? undefined : visit(provider);

      if (problem !== undefined) return problem;
    }

    visiting.pop();
    done.add(entry.id);
    ordered.push(entry);

    return undefined;
  }

  for (const entry of entries) {
    const problem = visit(entry);

    if (problem !== undefined) return { status: "refused", problems: [problem] };
  }

  return { status: "ordered", entries: ordered };
}

// A link to a provider whose target does not provide the link's kind.
export function unprovidedKindProblems(planned: ReadonlyMap<string, PlannedEntry>): CliProblem[] {
  return [...planned.values()].flatMap(({ entry }) =>
    linksOf(entry).flatMap(([kind, providerId]) => {
      const provider = planned.get(providerId);

      if (provider === undefined || Object.hasOwn(provider.target.metadata.provides, kind))
        return [];

      const provided = Object.keys(provider.target.metadata.provides).join(", ") || "nothing";

      return [
        {
          code: "link.kind.not-provided",
          message: `'${providerId}' (${provider.target.metadata.packageName}) does not provide '${kind}'; it provides ${provided}.`,
          fix: `Link an entry whose target provides '${kind}'.`,
          where: linkWhere(entry.id, providerId),
        },
      ];
    }),
  );
}

// Each api of a consumer needs the same api in each provider it links to, and the provider must keep every
// operation the consumer keeps (a provider keeping more is fine).
export function pairingProblems(planned: ReadonlyMap<string, PlannedEntry>): CliProblem[] {
  return [...planned.values()].flatMap((consumer) =>
    linksOf(consumer.entry).flatMap(([, providerId]) => {
      const provider = planned.get(providerId);

      if (provider === undefined) return [];

      return consumer.apis.flatMap((consumerApi) =>
        apiPairProblems(consumer, provider, consumerApi),
      );
    }),
  );
}

function apiPairProblems(
  consumer: PlannedEntry,
  provider: PlannedEntry,
  consumerApi: PlannedApi,
): CliProblem[] {
  const where = linkWhere(consumer.entry.id, provider.entry.id, consumerApi.api);
  const providerApi = pairedApi(provider, consumerApi);

  if (providerApi === undefined) {
    return [
      {
        code: "link.apis.unpaired",
        message: `'${provider.entry.id}' does not generate the api '${consumerApi.api}' that '${consumer.entry.id}' generates.`,
        fix: `Add '${consumerApi.api}' to the apis of '${provider.entry.id}', or remove it from '${consumer.entry.id}'.`,
        where,
      },
    ];
  }

  const providerOperationIds = new Set(providerApi.ir.operations.map((operation) => operation.id));
  const missing = consumerApi.ir.operations
    .map((operation) => operation.id)
    .filter((id) => !providerOperationIds.has(id));

  if (missing.length === 0) return [];

  return [
    {
      code: "link.operations.missing",
      message: `'${provider.entry.id}' leaves out operations '${consumer.entry.id}' keeps: ${missing.join(", ")}.`,
      fix: `Keep these operations in the \`document\` and \`operations\` of '${provider.entry.id}', or drop them from '${consumer.entry.id}'.`,
      where,
    },
  ];
}

export function pairedApi(provider: PlannedEntry, consumerApi: PlannedApi): PlannedApi | undefined {
  return provider.apis.find(
    (each) => each.api === consumerApi.api && each.source === consumerApi.source,
  );
}
