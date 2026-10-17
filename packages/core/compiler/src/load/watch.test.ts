import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadWatchFiles } from "./watch.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "seampact-watch-"));

  dirs.push(root);
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "api.yaml"), "api: { name: t }\n");
  writeFileSync(join(root, "sub/part.yaml"), "a: 1\n");
  writeFileSync(join(root, "unrelated.yaml"), "z: 1\n");

  return root;
}

test("watch notifies once per change burst, only for the files it was given", async () => {
  const root = workspace();
  let calls = 0;
  const watcher = loadWatchFiles(["api.yaml", "sub/part.yaml"], {
    root,
    debounceMs: 80,
    onChange: () => calls++,
  });

  try {
    await sleep(50);
    // One burst: three saves in quick succession, across two watched directories.
    writeFileSync(join(root, "api.yaml"), "api: { name: t }\n# 1\n");
    writeFileSync(join(root, "api.yaml"), "api: { name: t }\n# 2\n");
    writeFileSync(join(root, "sub/part.yaml"), "a: 2\n");
    await sleep(400);
    expect(calls).toBe(1);
    // A file the load never read does not notify.
    writeFileSync(join(root, "unrelated.yaml"), "z: 2\n");
    await sleep(300);
    expect(calls).toBe(1);
    // A later burst notifies again; a reload can retarget the set.
    watcher.update(["unrelated.yaml"]);
    await sleep(50);
    writeFileSync(join(root, "unrelated.yaml"), "z: 3\n");
    await sleep(300);
    expect(calls).toBe(2);
  } finally {
    watcher.close();
  }

  writeFileSync(join(root, "unrelated.yaml"), "z: 4\n");
  await sleep(200);
  expect(calls).toBe(2);
});

test("watch ignores files outside the root, but for a node_modules above it", async () => {
  const base = mkdtempSync(join(tmpdir(), "seampact-watch-out-"));

  dirs.push(base);
  const root = join(base, "ws");

  mkdirSync(root);
  mkdirSync(join(base, "node_modules/p"), { recursive: true });
  writeFileSync(join(base, "outside.yaml"), "x: 1\n");
  writeFileSync(join(base, "node_modules/p/package.json"), "{}\n");
  let calls = 0;
  const watcher = loadWatchFiles(
    ["../outside.yaml", "/etc/hostname", "../node_modules/p/package.json"],
    {
      root,
      debounceMs: 50,
      onChange: () => calls++,
    },
  );

  try {
    await sleep(50);
    writeFileSync(join(base, "outside.yaml"), "x: 2\n");
    await sleep(250);
    expect(calls).toBe(0);
    writeFileSync(join(base, "node_modules/p/package.json"), '{"v":1}\n');
    await sleep(250);
    expect(calls).toBe(1);
  } finally {
    watcher.close();
  }
});

test("watch update after close watches nothing", async () => {
  const root = workspace();
  let calls = 0;
  const watcher = loadWatchFiles([], { root, debounceMs: 30, onChange: () => calls++ });

  watcher.close();
  watcher.update(["api.yaml"]);
  writeFileSync(join(root, "api.yaml"), "api: { name: t }\n# 9\n");
  await sleep(150);
  expect(calls).toBe(0);
});
