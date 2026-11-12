import { expect, test } from "vitest";
import { checkFixtures, checkReport } from "./commands.ts";

// 1.x CI keeps the expected outputs current while the TS compiler lives: `node scripts/oracle/cli.ts write` after
// a change that moves them.
test("every fixture compiles to its expected outputs", async () => {
  const result = await checkFixtures(undefined);

  expect(result.fixtures).toBeGreaterThan(0);
  expect(checkReport(result)).toBe(
    `oracle: ${result.fixtures} fixtures, ${result.fixtures} match, 0 differ`,
  );
});
