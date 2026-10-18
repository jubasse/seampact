import { expect, test } from "vitest";
import { treeNodesIsCalendarDate } from "./calendar-date.js";

test("calendar dates refuse 2026-02-30, 2025-02-29, 1900-02-29 and 0000-01-01 and accept 2024-02-29 and 2000-02-29", () => {
  for (const refused of [
    "2026-02-30",
    "2025-02-29",
    "1900-02-29",
    "0000-01-01",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-01-00",
    "2026-1-01",
    "",
  ])
    expect(treeNodesIsCalendarDate(refused), refused).toBe(false);

  for (const accepted of ["2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31", "2027-06-30"])
    expect(treeNodesIsCalendarDate(accepted), accepted).toBe(true);
});
