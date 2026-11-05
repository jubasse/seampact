import type { Operation } from "@seampact/spec/ir";

export interface AskedRequirement {
  readonly member: "rights" | "rules";
  readonly name: string;
}

// The rights and rules an operation asks, through its requires and its field rights; one walk for every reader.
export function askedRequirements(operation: Operation): AskedRequirement[] {
  const fromRequires = operation.requires.flatMap((requirement): AskedRequirement[] => {
    if (requirement.kind === "right" && "right" in requirement)
      return [{ member: "rights", name: requirement.right }];

    if (requirement.kind === "rule" && "rule" in requirement)
      return [{ member: "rules", name: requirement.rule }];

    return [];
  });

  const fromFieldRights = operation.fieldRights.map(
    (fieldRight): AskedRequirement => ({ member: "rights", name: fieldRight.right }),
  );

  return [...fromRequires, ...fromFieldRights];
}
