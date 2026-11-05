// The checklist items a target proves only across several CI rows of its consumer: the pair passes when every row
// uploaded a suite report that passed the id. A row is named by the prefix of its http-suite artefact name.
import type { Item, Problem } from "./model.ts";
import type { SuiteProof } from "./suite-reports.ts";
import { expandTargets } from "./targets.ts";

export const VARIANT_ROWS_FILE = "scripts/checklist/variant-rows.ts";

export interface VariantRow {
  readonly name: string;
  readonly artefactPrefix: string;
}

export interface VariantRowSet {
  readonly target: string;
  readonly rows: readonly VariantRow[];
}

export const VARIANT_ROW_SETS: ReadonlyMap<string, VariantRowSet> = new Map([
  [
    "CHK-079",
    {
      target: "spring-boot",
      rows: [
        { name: "Gradle on Java 21", artefactPrefix: "spring-boot-http-suite-gradle-jdk21-" },
        { name: "Gradle on Java 25", artefactPrefix: "spring-boot-http-suite-gradle-jdk25-" },
        { name: "Maven on Java 21", artefactPrefix: "spring-boot-http-suite-maven-jdk21-" },
        { name: "Maven on Java 25", artefactPrefix: "spring-boot-http-suite-maven-jdk25-" },
      ],
    },
  ],
  [
    "CHK-081",
    {
      target: "nestjs",
      rows: [
        { name: "zod", artefactPrefix: "nestjs-http-suite-zod-" },
        { name: "class-validator", artefactPrefix: "nestjs-http-suite-class-validator-" },
      ],
    },
  ],
]);

/** Each row set that no longer holds: an unknown or retired id, or a target the item does not list. */
export function variantRowSetProblems(
  items: readonly Item[],
  variantRowSets: ReadonlyMap<string, VariantRowSet>,
): Problem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const problems: Problem[] = [];

  for (const [id, rowSet] of variantRowSets) {
    const item = byId.get(id);
    const at = (message: string) => problems.push({ file: VARIANT_ROWS_FILE, id, message });

    if (item === undefined || item.retired !== undefined)
      at("variant rows of an id that is not live in the checklist");
    else if (!expandTargets(item.targets).includes(rowSet.target))
      at(`variant rows of a target the item does not list: ${rowSet.target}`);
  }

  return problems;
}

/** Whether [proofs] hold a passed run of the pair and no failed one. */
export function passedWithoutFailure(proofs: readonly SuiteProof[]): boolean {
  return proofs.some((p) => p.outcome === "passed") && !proofs.some((p) => p.outcome === "failed");
}

/** The names of the rows of [rowSet] without a suite report among [proofs] that passed the pair. */
export function missingVariantRows(rowSet: VariantRowSet, proofs: readonly SuiteProof[]): string[] {
  return rowSet.rows
    .filter((row) => {
      const rowProofs = proofs.filter((p) => p.artefact?.startsWith(row.artefactPrefix) === true);

      return !passedWithoutFailure(rowProofs);
    })
    .map((row) => row.name);
}
