import * as fs from "node:fs";
import * as path from "node:path";
import { isAbsolutePath, loadNormalizePath } from "./paths.js";

export interface LoadWatchOptions {
  /** Absolute workspace root; the watched files are root-relative. */
  root: string;
  /** Quiet time after the last change before the callback fires. */
  debounceMs?: number;
  onChange: () => void;
}

export interface LoadWatcher {
  /** Replaces the watched set, after a reload read other files. */
  update(files: Iterable<string>): void;
  close(): void;
}

/**
 * Notifies once per burst of changes to the files the last load read. It watches each file's
 * directory (not the file), because editors save by renaming a temp file over the target, which
 * `fs.watch` on a file path does not survive. Known caveats, recorded for the CLI lane:
 * - macOS reports renames and writes under varying event names and may coalesce them; the
 *   debounce absorbs it, and a directory watch sees them all.
 * - Windows reports the file name in the system's case and may fire twice per save; both are
 *   absorbed by comparing names case-insensitively and by the debounce.
 * - `filename` can be null on some platforms; any event of the directory then counts.
 * - Only Linux is exercised by tests (one burst, one notification).
 */
/**
 * Only what a load may read is watched: a file under the root, or under a `node_modules` above
 * it (packages resolved upward, ADR 0008). Anything else in the list is ignored.
 */
function watchable(file: string): boolean {
  if (isAbsolutePath(file) || file.includes("\\")) return false;
  let rest = loadNormalizePath(file);
  let above = false;

  while (rest === ".." || rest.startsWith("../")) {
    rest = rest === ".." ? "" : rest.slice(3);
    above = true;
  }

  return !above || rest.startsWith("node_modules/");
}

export function loadWatchFiles(files: Iterable<string>, options: LoadWatchOptions): LoadWatcher {
  const debounce = options.debounceMs ?? 50;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchers: fs.FSWatcher[] = [];
  let closed = false;

  const fire = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;

      if (!closed) options.onChange();
    }, debounce);
  };

  const stop = () => {
    for (const w of watchers) w.close();
    watchers = [];
  };

  const start = (list: Iterable<string>) => {
    const byDir = new Map<string, Set<string>>();

    for (const file of list) {
      if (!watchable(file)) continue;
      const abs = path.resolve(options.root, file);
      const dir = path.dirname(abs);
      const names = byDir.get(dir) ?? new Set<string>();

      names.add(path.basename(abs).toLowerCase());
      byDir.set(dir, names);
    }

    for (const [dir, names] of [...byDir].sort(([a], [b]) => (a < b ? -1 : 1))) {
      try {
        const w = fs.watch(dir, { persistent: false }, (_event, filename) => {
          if (
            filename === null ||
            filename === undefined ||
            names.has(String(filename).toLowerCase())
          ) {
            fire();
          }
        });

        w.on("error", () => {});
        watchers.push(w);
      } catch {
        // A directory that vanished is reported by the next load, which cannot read its files.
      }
    }
  };

  start(files);

  return {
    update(next) {
      if (closed) return;
      stop();
      start(next);
    },
    close() {
      closed = true;

      if (timer !== undefined) clearTimeout(timer);
      stop();
    },
  };
}
