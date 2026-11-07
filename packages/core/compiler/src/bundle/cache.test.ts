import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { bundleCacheDirectory } from "./cache.js";

const HOME = join("/", "home", "user");

describe("bundleCacheDirectory", () => {
  test("SEAMPACT_CACHE_DIR wins on every platform", () => {
    expect(bundleCacheDirectory({ SEAMPACT_CACHE_DIR: "/cache" }, "win32", HOME)).toBe("/cache");
  });

  test("linux: XDG_CACHE_HOME, else ~/.cache, an empty value counting as unset", () => {
    expect(bundleCacheDirectory({ XDG_CACHE_HOME: "/xdg" }, "linux", HOME)).toBe(
      join("/xdg", "seampact"),
    );
    expect(bundleCacheDirectory({ XDG_CACHE_HOME: "" }, "linux", HOME)).toBe(
      join(HOME, ".cache", "seampact"),
    );
    expect(bundleCacheDirectory({}, "linux", HOME)).toBe(join(HOME, ".cache", "seampact"));
  });

  test("darwin: ~/Library/Caches", () => {
    expect(bundleCacheDirectory({ XDG_CACHE_HOME: "/xdg" }, "darwin", HOME)).toBe(
      join(HOME, "Library", "Caches", "seampact"),
    );
  });

  test("win32: LOCALAPPDATA, else ~/AppData/Local", () => {
    expect(bundleCacheDirectory({ LOCALAPPDATA: "/local" }, "win32", HOME)).toBe(
      join("/local", "seampact", "Cache"),
    );
    expect(bundleCacheDirectory({}, "win32", HOME)).toBe(
      join(HOME, "AppData", "Local", "seampact", "Cache"),
    );
  });
});
