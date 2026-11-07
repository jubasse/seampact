import { describe, expect, it } from "vitest";

import { packVariantFiles } from "./pack-variants.ts";

const SHARED_FILE = "shared/base.yaml";
const SHARED_HEADER = "# shared/base.yaml: the workspace's shared file, seen by both apis\n";
const TASKS_LIST_PAGING = "paging: { cursor: { maxLimit: 50 } }";

describe("packVariantFiles", () => {
  it("writes LF contracts whatever the line ends of the reference", () => {
    const base = [
      SHARED_HEADER,
      "defaults:\n",
      "  paging: { default: cursor, maxLimit: 100 }\n",
    ].join("");
    const tasks = `# tasks\r\n${TASKS_LIST_PAGING}\r\n                  sortable: [createdAt]\r\n`;
    const files = (lineEnd: string) =>
      new Map([
        [SHARED_FILE, base.replace(/\n/g, lineEnd)],
        ["tasks/api.yaml", tasks.replace(/\r?\n/g, lineEnd)],
        [
          "tasks/routes/tasks/search.yaml",
          `examples:${lineEnd}  firstPage: { status: 200, value: { $file: ../../examples/search-200.json } }${lineEnd}`,
        ],
      ]);

    const fromLf = packVariantFiles(files("\n"), "golden");
    const fromCrlf = packVariantFiles(files("\r\n"), "golden");

    expect(fromCrlf).toEqual(fromLf);
    expect([...fromCrlf.values()].some((text) => text.includes("\r"))).toBe(false);
  });
});
