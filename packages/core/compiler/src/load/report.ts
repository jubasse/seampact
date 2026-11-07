import type { SourceMap } from "@seampact/spec/ir";
import type { Diagnostic, DiagnosticOrigin } from "../diagnostics/diagnostic.js";
import { diagnosticLocationKey } from "../diagnostics/print.js";
import type { FileLayerId } from "../raw-tree.js";
import { escapePointer } from "@seampact/spec/json";

export type SiteLocation = SourceMap["locations"][string];

export interface PendingDiagnostic {
  rule: string; // short id, `seampact/load/` is added
  message: string;
  fix: string;
  at: SiteLocation;
  related?: { at: SiteLocation; message: string }[];
  severity?: "error" | "warning";
}

/**
 * A diagnostic about a file position that has no node in the merged tree (a file that fails to
 * parse, a second document, a tag, a missing include) is located by a site pointer. The
 * pointer starts with `~l`, which JSON Pointer never produces (`~` is always `~0` or `~1`), so it
 * cannot collide with a pointer into a merged tree. The `Diagnostic` seam is unchanged: the
 * origin still resolves through the side table.
 */
export function loadSitePointer(site: SiteLocation): string {
  return `/~load/${escapePointer(site.file)}/${site.line}/${site.column}`;
}

export class Reporter {
  readonly diagnostics: Diagnostic[] = [];
  readonly locations: SourceMap["locations"] = {};
  // Set by the loader before it works on a layer. A file shared by several apis is reported
  // once: its site pointer locates it the same way for every api (`RawWorkspace.locations`).
  layer: FileLayerId = "api";
  private readonly seen = new Set<string>();

  originAt(site: SiteLocation): DiagnosticOrigin {
    const origin: DiagnosticOrigin = { layer: this.layer, pointer: loadSitePointer(site) };

    this.locations[diagnosticLocationKey(origin)] = site;

    return origin;
  }

  /**
   * Gives the diagnostics reported since `since` under layer `from` the layer `to`, their table
   * keys with them: for a file whose layer is known only once it is read (an entry file whose
   * `$include` brings `workspace:` or `api:`). Those keys are used by nothing reported before.
   */
  relabel(since: number, from: FileLayerId, to: FileLayerId): void {
    const move = (origin: DiagnosticOrigin): DiagnosticOrigin => {
      if (origin.layer !== from) return origin;
      const key = diagnosticLocationKey(origin);
      const site = this.locations[key];

      delete this.locations[key];
      const moved: DiagnosticOrigin = { layer: to, pointer: origin.pointer };

      if (site) this.locations[diagnosticLocationKey(moved)] = site;

      return moved;
    };

    for (const d of this.diagnostics.slice(since)) {
      d.origin = move(d.origin);
      d.related = d.related.map((r) => ({ ...r, origin: move(r.origin) }));
    }
  }

  report(p: PendingDiagnostic): void {
    const identity = `${p.rule}|${p.at.file}|${p.at.line}|${p.at.column}|${p.message}`;

    if (this.seen.has(identity)) return;
    this.seen.add(identity);
    this.diagnostics.push({
      severity: p.severity ?? "error",
      rule: `seampact/load/${p.rule}`,
      message: p.message,
      fix: p.fix,
      origin: this.originAt(p.at),
      related: (p.related ?? []).map((r) => ({ origin: this.originAt(r.at), message: r.message })),
    });
  }
}
