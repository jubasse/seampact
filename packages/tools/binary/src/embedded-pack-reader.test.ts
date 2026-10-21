import type { LoadReader } from "@seampact/compiler";
import { describe, expect, it } from "vitest";
import { type EmbeddedPackage, readerWithEmbeddedPacks } from "./embedded-pack-reader.js";

const HAL: EmbeddedPackage = {
  name: "@seampact/pack-hal",
  files: { "package.json": '{"embedded":true}', "pack.yaml": "embedded: pack" },
};
const ASCENT = 2;
const EMBEDDED_PACK = "../../node_modules/@seampact/pack-hal/pack.yaml";
const MAX_BYTES = 1_000_000;

// A reader over root-relative file paths (already normalized) with their text.
function memoryReader(files: Record<string, string>): LoadReader {
  const directories = new Map<string, Set<string>>();

  for (const file of Object.keys(files)) {
    const parts = file.split("/");

    for (let depth = 1; depth <= parts.length; depth++) {
      const parent = parts.slice(0, depth - 1).join("/") || ".";

      directories.set(
        parent,
        (directories.get(parent) ?? new Set()).add(parts[depth - 1] as string),
      );
    }
  }

  return {
    ascent: ASCENT,
    readText(file) {
      const text = files[file];

      return text === undefined ? undefined : { text };
    },
    listDir(dir) {
      const names = directories.get(dir);

      return names === undefined ? undefined : [...names];
    },
    realPath(file) {
      return file in files || directories.has(file) ? file : undefined;
    },
  };
}

function readerOver(files: Record<string, string>) {
  return readerWithEmbeddedPacks(memoryReader(files), [HAL]);
}

describe("readerWithEmbeddedPacks", () => {
  it("serves an embedded file where nothing is installed", () => {
    expect(readerOver({}).readText(EMBEDDED_PACK, MAX_BYTES)).toEqual({ text: "embedded: pack" });
  });

  it("lets an installed copy win over the embedded one", () => {
    const reader = readerOver({ [EMBEDDED_PACK]: "installed: pack" });

    expect(reader.readText(EMBEDDED_PACK, MAX_BYTES)).toEqual({ text: "installed: pack" });
    expect(reader.embeddedLabel(EMBEDDED_PACK)).toBeUndefined();
  });

  it("merges the embedded names into the listing of the wrapped reader", () => {
    const reader = readerOver({ "../../node_modules/other/pack.yaml": "x" });

    expect(reader.listDir("../../node_modules")?.sort()).toEqual(["@seampact", "other"]);
    expect(reader.listDir("../../node_modules/@seampact/pack-hal")?.sort()).toEqual([
      "pack.yaml",
      "package.json",
    ]);
  });

  it("answers the real path of an embedded file and directory, and none for an absent one", () => {
    const reader = readerOver({});

    expect(reader.realPath(EMBEDDED_PACK)).toBe(EMBEDDED_PACK);
    expect(reader.realPath("../../node_modules/@seampact")).toBe("../../node_modules/@seampact");
    expect(reader.realPath("../../node_modules/@seampact/pack-none")).toBeUndefined();
  });

  it("refuses a file over the byte budget", () => {
    expect(readerOver({}).readText(EMBEDDED_PACK, 3)).toEqual({ tooLarge: true });
  });

  it("labels a served embedded file with an embedded: name", () => {
    const reader = readerOver({});

    reader.readText(EMBEDDED_PACK, MAX_BYTES);

    expect(reader.embeddedLabel(EMBEDDED_PACK)).toBe("embedded:@seampact/pack-hal/pack.yaml");
  });
});
