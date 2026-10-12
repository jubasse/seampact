import type { Origin } from "@seampact/spec/ir";
import { isScalar } from "yaml";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { diagnosticLocationKey, diagnosticSort } from "../diagnostics/print.js";
import type { JsonObject, RawApi, RawWorkspace, RawWorkspaceConfig } from "../raw-tree.js";
import { LoadBudget, loadWorkOf } from "./budget.js";
import { mergeLayers } from "./compose.js";
import { Expander, type LayerBuild, navigate } from "./expand.js";
import { asObject, isReservedKey, showValue } from "./json.js";
import { LOAD_MAX_DEPTH } from "./limits.js";
import { isInside, joinPath, loadNormalizePath, pointerEscape } from "./paths.js";
import type { LoadReader } from "./reader.js";
import { Reporter, type SiteLocation } from "./report.js";
import { FileStore, nodeSite, type ParsedFile } from "./source.js";

export interface LoadOptions {
  reader: LoadReader;
  /** Root-relative path of the entry file: `workspace.yaml`, or an api file when there is none. */
  entry: string;
}

export interface LoadResult {
  workspace: RawWorkspace;
  /** Every error of the load stage, sorted; the stage stops after it when any is an error. */
  diagnostics: Diagnostic[];
  /** Every file the load read or tried to read, sorted, for the watch primitive. */
  files: string[];
}

// npm's package-name grammar (validate-npm-package-name, new names): an optional `@scope/`, then
// lowercase URL-safe characters, no leading `.` or `_`, at most 214 characters. A name outside it
// could fold `node_modules/<name>` out of `node_modules` (`x/../../..`). `~` and `*`, which npm
// allows, are refused too: `progra~1` is a Windows short name for another directory, and `*` a
// wildcard for any tool that globs the path.
const PACKAGE_NAME = /^(?:@[a-z0-9-][a-z0-9-._]*\/)?[a-z0-9-][a-z0-9-._]*$/;
const PACKAGE_NAME_MAX = 214;

// The keys a pack may hold (ADR 0002 section 1, table of file kinds).
const PACK_KEYS = new Set([
  "pack",
  "schemas",
  "enums",
  "scalars",
  "errors",
  "natures",
  "schemes",
  "headers",
  "identities",
  "rights",
  "rules",
  "requirements",
  "scopes",
  "buckets",
  "services",
  "pagings",
  "formats",
  "conventions",
  "extensions",
  "lint",
  "derive",
]);

interface PackBuild {
  key: string;
  name: string;
  build: LayerBuild;
  extendsRefs: { ref: string; at: SiteLocation }[];
}

interface ApiState {
  order: PackBuild[];
  done: Set<string>;
}

export function loadWorkspace(options: LoadOptions): LoadResult {
  return new Loader(options).run();
}

class Loader {
  private readonly rep = new Reporter();
  private readonly budget = new LoadBudget(this.rep);
  private readonly store: FileStore;
  private readonly ex: Expander;
  private readonly builds = new Map<string, LayerBuild>();
  private readonly finished = new Set<LayerBuild>();
  private readonly packs = new Map<string, PackBuild | null>();
  private readonly packNames = new Map<string, PackBuild>();

  constructor(private readonly options: LoadOptions) {
    this.store = new FileStore(options.reader, this.rep);
    this.ex = new Expander(this.store, this.rep, this.budget);
  }

  run(): LoadResult {
    const apis: RawApi[] = [];
    const config: RawWorkspaceConfig = {};
    const entry = loadNormalizePath(this.options.entry);
    const entrySite: SiteLocation = { file: entry, line: 1, column: 1, endLine: 1, endColumn: 1 };
    this.rep.layer = "api";
    let entryBuild: LayerBuild | undefined;
    if (!isInside(".", entry)) {
      this.rep.report({
        rule: "path-escape",
        message: `the entry file '${entry}' is outside the workspace root`,
        fix: "name an entry file inside the workspace root",
        at: entrySite,
      });
    } else if (typeof this.store.checkFile(entry, ".", entrySite, "the entry file") === "string") {
      const pf = this.store.parse(entry, ".");
      if (pf) entryBuild = this.layer(pf, "api");
    }
    if (entryBuild) {
      const tree = entryBuild.tree;
      const ws = asObject(tree.workspace);
      if (ws) {
        this.workspaceMode(entryBuild, ws, apis, config);
      } else if (asObject(tree.api)) {
        const name = asObject(tree.api)?.name;
        if (typeof name === "string") this.loadApi(name, entryBuild, undefined, apis);
        else
          this.badShape(
            entryBuild,
            "/api",
            "the api file has no api.name",
            "write api: { name: <name> }",
          );
      } else {
        this.badShape(
          entryBuild,
          "",
          "the entry file is neither a workspace (workspace:) nor an api (api:)",
          "start the file with workspace: or api:",
        );
      }
    }
    const locations = this.rep.locations;
    const workspace: RawWorkspace = { root: ".", apis, locations };
    if (Object.keys(config).length > 0) workspace.config = config;
    return {
      workspace,
      diagnostics: diagnosticSort(this.rep.diagnostics, locations),
      files: [...this.store.touched].sort(),
    };
  }

  private badShape(b: LayerBuild, ptr: string, message: string, fix: string): void {
    this.rep.report({
      rule: "workspace-shape",
      message,
      fix,
      at: b.locs.get(ptr) ?? nodeSite(b.parsed, b.parsed.root),
    });
  }

  private layer(pf: ParsedFile, layer: Origin["layer"]): LayerBuild {
    const key = `${layer}|${pf.boundary}|${pf.path}`;
    const hit = this.builds.get(key);
    if (hit) return hit;
    const saved = this.rep.layer;
    this.rep.layer = layer;
    const build = this.ex.expandLayer(pf, layer);
    this.rep.layer = saved;
    this.builds.set(key, build);
    return build;
  }

  private workspaceMode(
    entry: LayerBuild,
    ws: JsonObject,
    apis: RawApi[],
    config: RawWorkspaceConfig,
  ): void {
    const site = (ptr: string) => entry.locs.get(ptr) ?? nodeSite(entry.parsed, entry.parsed.root);
    if (typeof ws.editorSchemas === "string") config.editorSchemas = ws.editorSchemas;
    if (ws.imports !== undefined) config.imports = ws.imports;
    const list = asObject(ws.apis);
    if (!list || Object.keys(list).length === 0) {
      this.badShape(
        entry,
        "/workspace",
        "workspace.apis maps no api",
        "write workspace: { apis: { <name>: ./api.yaml } }",
      );
      return;
    }
    let shared: LayerBuild | undefined;
    if (ws.shared !== undefined) {
      if (typeof ws.shared !== "string") {
        this.badShape(
          entry,
          "/workspace/shared",
          "workspace.shared takes a path",
          "write shared: ./shared/base.yaml",
        );
      } else {
        const r = this.store.resolve(
          entry.parsed,
          ws.shared,
          site("/workspace/shared"),
          "workspace",
        );
        const pf = r && this.store.parse(r.path, ".");
        if (pf) shared = this.layer(pf, "shared");
      }
    }
    for (const [name, raw] of Object.entries(list)) {
      // Once the budget is spent, the apis left would only report what an empty tree lacks.
      if (this.budget.exhausted) break;
      const at = site(`/workspace/apis/${pointerEscape(name)}`);
      if (typeof raw !== "string") {
        this.rep.report({
          rule: "workspace-shape",
          message: `workspace.apis.${name} takes a path`,
          fix: "write the api file's path",
          at,
        });
        continue;
      }
      const r = this.store.resolve(entry.parsed, raw, at, "workspace");
      const pf = r && this.store.parse(r.path, ".");
      if (!pf) continue;
      this.rep.layer = "api";
      const build = this.layer(pf, "api");
      const declared = asObject(build.tree.api)?.name;
      if (declared !== name) {
        this.rep.report({
          rule: "api-name-mismatch",
          message: `workspace.apis names this api '${name}', and api.name is '${showValue(declared)}'`,
          fix: "make the two names equal",
          at: build.locs.get("/api/name") ?? nodeSite(pf, pf.root),
          related: [{ at, message: "named here" }],
        });
      }
      this.loadApi(name, build, shared, apis);
    }
  }

  private loadApi(
    name: string,
    api: LayerBuild,
    shared: LayerBuild | undefined,
    apis: RawApi[],
  ): void {
    this.rep.layer = "api";
    if (isReservedKey(name)) {
      this.rep.report({
        rule: "reserved-key",
        message: `'${name}' cannot name an api: it names a property every JavaScript object inherits`,
        fix: "rename the api",
        at: api.locs.get("/api/name") ?? nodeSite(api.parsed, api.parsed.root),
      });
      return;
    }
    const state: ApiState = { order: [], done: new Set() };
    // base
    let base: LayerBuild | undefined;
    const ext = api.tree.extends;
    if (ext !== undefined) {
      const at = api.locs.get("/extends") ?? nodeSite(api.parsed, api.parsed.root);
      if (typeof ext !== "string") {
        this.rep.report({
          rule: "extends-shape",
          message: "an api extends at most one base, written as a path",
          fix: "write extends: ./base.yaml",
          at,
        });
      } else {
        const r = this.store.resolve(api.parsed, ext, at, "extends");
        if (r && r.path === api.parsed.path) {
          this.rep.report({
            rule: "extends-cycle",
            message: `the api extends itself (P8): ${r.path} -> ${r.path}`,
            fix: "break the cycle: extend a base file",
            at,
          });
        } else {
          const pf = r && this.store.parse(r.path, api.parsed.boundary);
          if (pf) base = this.layer(pf, "base");
        }
      }
    }
    for (const [what, b] of [
      ["shared file", shared],
      ["base", base],
    ] as const) {
      if (b && b.tree.extends !== undefined) {
        this.rep.layer = b.layer;
        this.rep.report({
          rule: "base-extends",
          message: `a ${what} extends nothing (the file '${b.parsed.path}' has extends)`,
          fix: "what every api shares goes in the workspace's shared file; anything beyond travels as packs",
          at: b.locs.get("/extends") ?? nodeSite(b.parsed, b.parsed.root),
        });
      }
    }
    const sharedPacks = shared ? this.applyList(shared, state) : [];
    const basePacks = base ? this.applyList(base, state) : [];
    this.applyList(api, state);

    const order: LayerBuild[] = [
      ...state.order.map((p) => p.build),
      ...(shared ? [shared] : []),
      ...(base ? [base] : []),
      api,
    ];
    // Layer names clash: the layer id is the pack name, so two packs of one name are one layer.
    // Each pack visited is charged: an api recomputes the closure of every pack it applies.
    const apiSite = () => nodeSite(api.parsed, api.parsed.root);
    const closure = (p: PackBuild, seen = new Set<string>()): Set<string> => {
      if (seen.has(p.key) || !this.budget.charge(1, apiSite)) return seen;
      seen.add(p.key);
      for (const e of p.extendsRefs) {
        const sub = this.findPack(e.ref, p.build);
        if (sub) closure(sub, seen);
      }
      return seen;
    };
    const layerName = (key: string) => this.packs.get(key)?.build.layer as Origin["layer"];
    const closureNames = (list: PackBuild[]) => {
      const keys = new Set<string>();
      for (const p of list) for (const k of closure(p)) keys.add(k);
      return [...keys].map(layerName);
    };
    const sharedSees: Origin["layer"][] = shared ? ["shared", ...closureNames(sharedPacks)] : [];
    const baseSees: Origin["layer"][] = base
      ? ["base", ...closureNames(basePacks), ...sharedSees]
      : [];
    // Null prototype: the keys are layer ids, which embed pack names an author chose.
    const vis: RawApi["visibility"] = Object.create(null);
    for (const p of state.order) vis[p.build.layer] = closureNames([p]).sort();
    if (shared) vis.shared = [...sharedSees].sort();
    if (base) vis.base = [...new Set(baseSees)].sort();
    vis.api = order.map((b) => b.layer).sort();

    // Finish each layer once its visible layers are finished: schema files reached by `$ref`.
    const byLayer = new Map(order.map((b) => [b.layer as string, b]));
    for (const b of order) {
      if (this.finished.has(b)) continue;
      this.finished.add(b);
      this.rep.layer = b.layer;
      this.ex.finishRefs(b, (n) => {
        const sees = vis[b.layer] ?? [];
        if (!this.budget.charge(sees.length, apiSite)) return undefined;
        for (const l of sees) {
          if (l === b.layer) continue;
          const other = byLayer.get(l);
          if (other && Object.hasOwn(asObject(other.tree.schemas) ?? {}, n)) {
            const at = `/schemas/${pointerEscape(n)}`;
            return { site: other.locs.get(at), layer: l, source: other.sources.get(at) };
          }
        }
        return undefined;
      });
    }

    // Names a layer uses but only a layer it does not build on declares. The declaring layers of
    // each name are indexed once per api, in application order, and every lookup is charged.
    const declaredBy = new Map<string, LayerBuild[]>();
    for (const b of order) {
      for (const section of [asObject(b.tree.schemas), asObject(b.tree.enums)]) {
        for (const n of Object.keys(section ?? {})) {
          if (!this.budget.charge(1, apiSite)) break;
          const list = declaredBy.get(n);
          if (!list) declaredBy.set(n, [b]);
          else if (list[list.length - 1] !== b) list.push(b);
        }
      }
    }
    for (const b of order) {
      const sees = new Set(vis[b.layer] ?? []);
      for (const use of b.uses) {
        const by = declaredBy.get(use.name) ?? [];
        if (!this.budget.charge(1 + by.length, apiSite)) break;
        if (by.some((o) => o === b || sees.has(o.layer))) continue;
        const other = by[0];
        if (!other) continue;
        this.rep.layer = b.layer;
        this.rep.report({
          rule: "name-not-visible",
          message: `'${use.name}' is used in '${use.at.file}' but declared only in '${other.parsed.path}' (layer '${other.layer}'), which '${b.layer}' does not build on`,
          fix: "move the declaration into the shared file or the base",
          at: use.at,
          related: [
            {
              at:
                other.locs.get(`/schemas/${pointerEscape(use.name)}`) ??
                other.locs.get(`/enums/${pointerEscape(use.name)}`) ??
                nodeSite(other.parsed, other.parsed.root),
              message: "declared here",
            },
          ],
        });
      }
    }

    this.rep.layer = "api";
    const { merged, leafOrigins } = mergeLayers(order, this.rep, this.budget);
    // ADR 0004 section 11: this api's own table, keyed exactly as its origins serialise. Each
    // entry is charged: a layer shared by many apis is written into each one's table.
    const locations: RawApi["locations"] = {};
    for (const b of order) {
      for (const [pointer, site] of b.locs) {
        const key = diagnosticLocationKey({ layer: b.layer, pointer });
        if (!this.budget.charge(loadWorkOf(key), site)) break;
        locations[key] = site;
      }
    }
    apis.push({
      name,
      layers: order.map((b) => ({ layer: b.layer, file: b.parsed.path, tree: b.tree })),
      merged,
      leafOrigins,
      locations,
      visibility: vis,
    });
  }

  // ---- packs ----

  private applyList(owner: LayerBuild, state: ApiState): PackBuild[] {
    const raw = owner.tree.packs;
    const reached: PackBuild[] = [];
    if (raw === undefined) return reached;
    this.rep.layer = owner.layer;
    if (!Array.isArray(raw)) {
      this.rep.report({
        rule: "pack-shape",
        message: "packs is a list of paths and package names",
        fix: "write packs: ['@seampact/pack-crud-rights', ./packs/house.yaml]",
        at: owner.locs.get("/packs") ?? nodeSite(owner.parsed, owner.parsed.root),
      });
      return reached;
    }
    raw.forEach((ref, i) => {
      const at = owner.locs.get(`/packs/${i}`) ?? nodeSite(owner.parsed, owner.parsed.root);
      if (typeof ref !== "string") {
        this.rep.layer = owner.layer;
        this.rep.report({
          rule: "pack-shape",
          message: "a pack is named by a path or a package name",
          fix: "write a string",
          at,
        });
        return;
      }
      this.rep.layer = owner.layer;
      const pack = this.loadPack(ref, owner, at);
      if (pack) {
        reached.push(pack);
        this.visit(pack, [], state);
      }
    });
    return reached;
  }

  private visit(pack: PackBuild, stack: PackBuild[], state: ApiState): void {
    if (state.done.has(pack.key)) return;
    const at = stack.findIndex((p) => p.key === pack.key);
    if (at >= 0) {
      const cycle = [...stack.slice(at), pack];
      this.rep.layer = pack.build.layer;
      this.rep.report({
        rule: "pack-cycle",
        message: `pack extends cycle (P8): ${cycle.map((p) => p.build.parsed.path).join(" -> ")}`,
        fix: "break the cycle by removing one extends of it",
        at: nodeSite(pack.build.parsed, pack.build.parsed.root),
        related: cycle.slice(0, -1).map((p) => ({
          at: p.build.locs.get("/pack/extends") ?? nodeSite(p.build.parsed, p.build.parsed.root),
          message: `'${p.name}' extends from here`,
        })),
      });
      return;
    }
    if (stack.length >= LOAD_MAX_DEPTH) {
      this.store.reportTooDeep(nodeSite(pack.build.parsed, pack.build.parsed.root));
      return;
    }
    const next = [...stack, pack];
    for (const e of pack.extendsRefs) {
      this.rep.layer = pack.build.layer;
      const sub = this.loadPack(e.ref, pack.build, e.at);
      if (sub) this.visit(sub, next, state);
    }
    state.done.add(pack.key);
    state.order.push(pack);
  }

  private findPack(ref: string, from: LayerBuild): PackBuild | undefined {
    const key = this.packKeyCache.get(`${from.parsed.path}|${ref}`);
    return key ? (this.packs.get(key) ?? undefined) : undefined;
  }

  private readonly packKeyCache = new Map<string, string>();

  private loadPack(ref: string, from: LayerBuild, at: SiteLocation): PackBuild | undefined {
    let file: string | undefined;
    let boundary = from.parsed.boundary;
    let pkg: { name: string; version: unknown; dir: string } | undefined;
    if (ref.startsWith("./") || ref.startsWith("../")) {
      file = this.store.resolve(from.parsed, ref, at, "pack")?.path;
    } else {
      const found = this.resolvePackage(ref, at);
      if (!found) return undefined;
      file = found.file;
      boundary = found.dir;
      pkg = { name: ref, version: found.version, dir: found.dir };
    }
    if (!file) return undefined;
    const key = `${boundary}|${file}`;
    this.packKeyCache.set(`${from.parsed.path}|${ref}`, key);
    const hit = this.packs.get(key);
    if (hit !== undefined) return hit ?? undefined;
    const pf = this.store.parse(file, boundary);
    if (!pf?.root) {
      this.packs.set(key, null);
      return undefined;
    }
    // The layer id is the manifest name; read it from the syntax tree before expanding.
    const nameNode = navigate(pf, "/pack/name");
    const written = isScalar(nameNode) ? nameNode.value : undefined;
    const name = typeof written === "string" ? written : ref;
    const layerId: Origin["layer"] = `pack:${name}`;
    const build = this.layer(pf, layerId);
    const saved = this.rep.layer;
    this.rep.layer = layerId;
    const tree = build.tree;
    const manifest = asObject(tree.pack);
    const extendsRefs: PackBuild["extendsRefs"] = [];
    if (!manifest || typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      this.rep.report({
        rule: "pack-manifest",
        message: `the pack file '${file}' has no manifest with a name and a version`,
        fix: "start the pack with pack: { name: <name>, version: <semver>, extends: [] }",
        at: build.locs.get("/pack") ?? nodeSite(pf, pf.root),
      });
    } else {
      const ext = manifest.extends;
      if (ext !== undefined && !Array.isArray(ext)) {
        this.rep.report({
          rule: "pack-manifest",
          message: "pack.extends is a list of packs",
          fix: "write extends: []",
          at: build.locs.get("/pack/extends") ?? nodeSite(pf, pf.root),
        });
      } else if (Array.isArray(ext)) {
        ext.forEach((e, i) => {
          if (typeof e === "string") {
            extendsRefs.push({
              ref: e,
              at: build.locs.get(`/pack/extends/${i}`) ?? nodeSite(pf, pf.root),
            });
          }
        });
      }
      if (pkg) {
        if (manifest.version !== pkg.version) {
          this.rep.report({
            rule: "pack-version-mismatch",
            message: `the pack manifest says version ${manifest.version} and the package.json of '${pkg.name}' says ${String(pkg.version)}`,
            fix: "write the version once, in the manifest: make package.json agree with it",
            at: build.locs.get("/pack/version") ?? nodeSite(pf, pf.root),
          });
        }
        if (manifest.name !== pkg.name) {
          this.rep.report({
            rule: "pack-name-mismatch",
            message: `the pack manifest names the pack '${manifest.name}', and it is the package '${pkg.name}'`,
            fix: "name the pack as its package",
            at: build.locs.get("/pack/name") ?? nodeSite(pf, pf.root),
          });
        }
      }
    }
    for (const k of Object.keys(tree)) {
      if (!PACK_KEYS.has(k)) {
        this.rep.report({
          rule: "pack-not-data",
          message: `the pack file '${file}' holds '${k}', which is not a pack key; a pack is data only`,
          fix: "keep to the keys of a pack (pack, the catalogues, conventions, formats, extensions, lint, derive)",
          at: build.locs.get(`/${pointerEscape(k)}`) ?? nodeSite(pf, pf.root),
        });
      }
    }
    const pack: PackBuild = { key, name, build, extendsRefs };
    const clash = this.packNames.get(name);
    if (clash && clash.key !== key) {
      this.rep.report({
        rule: "pack-name-clash",
        message: `two packs are named '${name}'`,
        fix: "give each pack its own name",
        at: build.locs.get("/pack/name") ?? nodeSite(pf, pf.root),
        related: [
          {
            at:
              clash.build.locs.get("/pack/name") ??
              nodeSite(clash.build.parsed, clash.build.parsed.root),
            message: "also named here",
          },
        ],
      });
    } else {
      this.packNames.set(name, pack);
    }
    this.rep.layer = saved;
    this.packs.set(key, pack);
    return pack;
  }

  /**
   * Walks `node_modules` from the workspace root upward with the reader (ADR 0008). The name is
   * checked against npm's grammar, and each candidate directory must be exactly
   * `<up>/node_modules/<name>`, before anything is read.
   *
   * Hook for p3-dist: the first-party packs embedded in the standalone binary (ADR 0002 section 2)
   * are the fallback when no package resolves, at the `pack-not-found` report below, served
   * through the injected reader like any other file.
   */
  private resolvePackage(
    name: string,
    at: SiteLocation,
  ): { file: string; dir: string; version: unknown } | undefined {
    const reader = this.options.reader;
    const refuse = () => {
      this.rep.report({
        rule: "pack-name",
        message: `'${name}' is neither a path (starting with ./ or ../) nor a package name`,
        fix: "write a package name such as @seampact/pack-crud-rights, or a path such as ./packs/house.yaml",
        at,
      });
      return undefined;
    };
    if (name.length > PACKAGE_NAME_MAX || !PACKAGE_NAME.test(name)) return refuse();
    for (let depth = 0; depth <= reader.ascent; depth++) {
      const up = depth === 0 ? "" : `${Array.from({ length: depth }, () => "..").join("/")}/`;
      const dir = joinPath(".", `${up}node_modules/${name}`);
      if (dir !== `${up}node_modules/${name}`) return refuse(); // kept should the grammar loosen
      const manifestPath = `${dir}/package.json`;
      this.store.touched.add(manifestPath);
      // Contained and case-checked like any file, its real path read; a missing one is no error,
      // the walk goes on upward.
      const checked = this.store.checkFile(manifestPath, dir, at, "packs", manifestPath, true);
      if (checked === null) continue;
      if (checked === undefined) return undefined;
      const text = this.store.rawText(manifestPath);
      if (text === undefined) continue;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        this.rep.report({
          rule: "pack-package",
          message: `'${manifestPath}' is not valid JSON`,
          fix: "fix the package.json",
          at,
        });
        return undefined;
      }
      const meta =
        (json as { seampact?: { role?: unknown; pack?: unknown }; version?: unknown }) ?? {};
      if (meta.seampact?.role !== "pack" || typeof meta.seampact.pack !== "string") {
        this.rep.report({
          rule: "pack-package",
          message: `the package '${name}' is not a pack: its package.json needs seampact.role: pack and seampact.pack naming the entry file`,
          fix: "install a convention pack, or reference a pack file by path",
          at,
        });
        return undefined;
      }
      const entry = this.store.resolve(
        { path: manifestPath, boundary: dir },
        meta.seampact.pack,
        at,
        "manifest",
      );
      if (!entry) return undefined;
      return { file: entry.path, dir, version: meta.version };
    }
    this.rep.report({
      rule: "pack-not-found",
      message: `the package '${name}' named in packs is not installed at or above the workspace root`,
      fix: `install ${name}, or write the pack as a path (./packs/${name.split("/").pop()}.yaml)`,
      at,
    });
    return undefined;
  }
}
