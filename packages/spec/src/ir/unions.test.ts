import { expect, test } from "vitest";
import type { Identity } from "./types.generated.js";
import { isKnownVariant } from "./unions.js";

// The principal name a reader derives from an identity: the unknown arm must be handled before the switch.
function principalSchemas(identity: Identity): string[] {
  const principal = identity.principal;
  if (!isKnownVariant("Principal", principal))
    throw new Error(`unknown principal ${principal.kind}`);
  switch (principal.kind) {
    case "schema":
      return [principal.schema];
    case "variants":
      return Object.values(principal.variants);
  }
}

const identity = (principal: unknown): Identity => ({ principal }) as unknown as Identity;

test("isKnownVariant narrows a union to its known variants", () => {
  expect(principalSchemas(identity({ kind: "schema", schema: "User" }))).toEqual(["User"]);
  expect(principalSchemas(identity({ kind: "variants", variants: { a: "A", b: "B" } }))).toEqual([
    "A",
    "B",
  ]);
  expect(() => principalSchemas(identity({ kind: "group", schemas: [] }))).toThrow(
    "unknown principal group",
  );
  expect(isKnownVariant("KeysPolicy", { policy: "drop" } as never)).toBe(false);
  expect(isKnownVariant("KeysPolicy", { policy: "keep", reason: "r" })).toBe(true);
});
