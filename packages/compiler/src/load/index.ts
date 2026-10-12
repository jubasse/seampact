// The load stage (ADR 0006 section 1): contract workspaces read into located raw trees.
//
// Trust model (user decision, p1 naming review): contract files and the packs installed next to
// them are trusted like any dependency the user chooses to install, as npm packages, ESLint and
// Babel plugins are (a pack, unlike them, is data only). The loader does not try to be an
// antivirus: it adds no denial-of-service hardening of its own beyond what is already here.
// It does keep what is a correctness or safety bug whoever wrote the files:
// - root containment: nothing outside the workspace root (or a pack's package) is ever read,
//   links and `../` included;
// - prototype keys refused (`__proto__`, `constructor`, `prototype`), so a tree is plain data;
// - depth, per-file size and the per-load budget (`limits.ts`, `budget.ts`), which turn a runaway
//   include or expansion into a located error instead of a hang.
// A pitfall in what an author writes (P1 to P9) is a diagnostic, not a defence: it keeps the YAML
// an author means the YAML the compiler reads.

export { loadWorkspace, type LoadOptions, type LoadResult } from "./loader.js";
export { type LoadReader, loadFsReader } from "./reader.js";
export { type LoadWatcher, type LoadWatchOptions, loadWatchFiles } from "./watch.js";
