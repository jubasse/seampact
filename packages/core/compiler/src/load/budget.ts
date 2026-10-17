import { LOAD_MAX_TEXT, LOAD_MAX_WORK } from "./limits.js";
import type { Reporter, SiteLocation } from "./report.js";

/**
 * The one budget of a load. Every unit of work authored input drives is charged to it, wherever
 * the work happens: each node expanded (once per use of the file holding it), each `$include`
 * target and `$file` site, each node copied into an api's merged tree, each leaf origin and
 * location written, each pack visited for visibility. The characters of every string admitted
 * into a tree, keys included, are charged to its text limit, once per use and once per api the
 * string reaches. A charge never stops at a cache: a file parsed once and used a thousand times
 * is charged a thousand times, since each use builds its own nodes.
 *
 * The first charge over a limit reports `seampact/load/expansion-limit` at the site that made it,
 * and every later charge fails, so the load winds down without further work.
 */
export class LoadBudget {
  private work = 0;
  private text = 0;
  private spent = false;

  constructor(private readonly rep: Reporter) {}

  get exhausted(): boolean {
    return this.spent;
  }

  /** Charges `units` of work; false once the budget is spent. */
  charge(units: number, at: SiteLocation | (() => SiteLocation)): boolean {
    if (this.spent) return false;
    this.work += units;

    if (this.work <= LOAD_MAX_WORK) return true;

    return this.exhaust(
      `the contract takes more than ${LOAD_MAX_WORK} units of work to load (nodes built for each use of a file, $include targets, nodes merged into each api); the load stops here`,
      "look for a file included many times over, through includes of includes, or a large file shared by many apis",
      at,
    );
  }

  /** Charges the characters of an admitted string; false once the budget is spent. */
  chargeText(chars: number, at: SiteLocation | (() => SiteLocation)): boolean {
    if (this.spent) return false;
    this.text += chars;

    if (this.text <= LOAD_MAX_TEXT) return true;

    return this.exhaust(
      `the contract holds more than ${LOAD_MAX_TEXT} characters of text, counted for each use of a file and each api it reaches; the load stops here`,
      "look for a large text or data file read by many $file or $include sites, or shared by many apis",
      at,
    );
  }

  private exhaust(message: string, fix: string, at: SiteLocation | (() => SiteLocation)): false {
    this.spent = true;
    this.rep.report({
      rule: "expansion-limit",
      message,
      fix,
      at: typeof at === "function" ? at() : at,
    });

    return false;
  }
}

/**
 * The work of writing a pointer (or any key built from authored text): one unit, plus one per
 * 256 characters, so a node under a very long key costs what hashing its pointer costs.
 */
export function loadWorkOf(text: string): number {
  return 1 + (text.length >>> 8);
}
