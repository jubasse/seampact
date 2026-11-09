import { DEFAULT_IMPORT_SPECIFIER_STYLE, type ImportSpecifierStyle } from "@seampact/codegen-core";
import { type CliProblem, entryWhere } from "../cli-problem.js";
import { linksOf, type PlannedEntry } from "./entry-links.js";
import type { Step } from "./step.js";

// The import specifier style each entry generates with: a target's own, and for a provider the style of the
// consumers linked to it, since the consumer's bundler reads the provider's files too. A provider whose consumers
// ask two styles is refused, naming them.

/** The style of each entry, by entry id, or the problem of each provider asked two styles. */
export function importSpecifierStyles(
  planned: readonly PlannedEntry[],
): Step<ReadonlyMap<string, ImportSpecifierStyle>> {
  const askedBy = new Map<string, Map<ImportSpecifierStyle, string[]>>();

  for (const { entry, target } of planned) {
    const own = target.metadata.importSpecifiers;

    if (own !== undefined) recordAsk(askedBy, entry.id, own, entry.id);

    for (const [, providerId] of linksOf(entry)) {
      recordAsk(askedBy, providerId, own ?? DEFAULT_IMPORT_SPECIFIER_STYLE, entry.id);
    }
  }

  const styles = new Map<string, ImportSpecifierStyle>();
  const problems: CliProblem[] = [];

  for (const [entryId, asks] of askedBy) {
    const [first, ...others] = [...asks.keys()];

    if (first !== undefined && others.length === 0) styles.set(entryId, first);
    else problems.push(mixedStylesProblem(entryId, asks));
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: styles };
}

function recordAsk(
  askedBy: Map<string, Map<ImportSpecifierStyle, string[]>>,
  entryId: string,
  style: ImportSpecifierStyle,
  askingEntryId: string,
): void {
  const asks = askedBy.get(entryId) ?? new Map<ImportSpecifierStyle, string[]>();
  const askers = asks.get(style) ?? [];

  askers.push(askingEntryId);
  asks.set(style, askers);
  askedBy.set(entryId, asks);
}

function mixedStylesProblem(
  entryId: string,
  asks: ReadonlyMap<ImportSpecifierStyle, readonly string[]>,
): CliProblem {
  const described = [...asks]
    .map(
      ([style, askers]) =>
        `${askers.map((id) => `'${id}'`).join(", ")} import with '${style}' specifiers`,
    )
    .join("; ");

  return {
    code: "link.importSpecifiers.mixed",
    message: `The entry '${entryId}' is linked from entries that import its files differently: ${described}.`,
    fix: `Give each group of entries its own '${entryId}' entry, with its own 'out', and link each group to its own.`,
    where: entryWhere(entryId),
  };
}
