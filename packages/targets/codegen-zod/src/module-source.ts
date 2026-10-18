import { posix } from "node:path";
import { MODULE_EXTENSION, WIRE_CHECKS_MODULE } from "./layout.js";

// The generated checks the validators share: the code point counter and the `date-time` check.
export const CODE_POINT_LENGTH = "codePointLength";
export const IS_DATE_TIME = "isDateTime";

export type WireCheck = typeof CODE_POINT_LENGTH | typeof IS_DATE_TIME;

// A module's declarations and what it imports beside zod.
export interface ModuleSource {
  declarations: readonly string[];
  wireChecks: ReadonlySet<WireCheck>;
  namespaces: readonly { name: string; module: string }[];
}

// The checks module. A JavaScript string's `length` counts UTF-16 units, JSON Schema's lengths code points.
// `date-time` follows ADR 0003 section 8: `T` and `Z` in either case, a fraction of 1 to 9 digits, a required
// offset, a real calendar date, and no leap second. `setUTCFullYear` keeps the years 0 to 99 as written.
export const WIRE_CHECKS_SOURCE = `export function ${CODE_POINT_LENGTH}(value: string): number {
return Array.from(value).length;
}

const DATE_TIME =
/^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\\.[0-9]{1,9})?(?:[Zz]|[+-]([0-9]{2}):([0-9]{2}))$/;

export function ${IS_DATE_TIME}(value: string): boolean {
const match = DATE_TIME.exec(value);

if (match === null) return false;

const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, offsetHour = 0, offsetMinute = 0] =
match.slice(1).map((part) => Number(part ?? "0"));
const date = new Date(0);

date.setUTCFullYear(year, month - 1, day);

return (
date.getUTCFullYear() === year &&
date.getUTCMonth() === month - 1 &&
date.getUTCDate() === day &&
hour < 24 &&
minute < 60 &&
second < 60 &&
offsetHour < 24 &&
offsetMinute < 60
);
}
`;

// The file contents of a module, or undefined when it declares nothing.
export function moduleContents(module: string, source: ModuleSource): string | undefined {
  if (source.declarations.length === 0) return undefined;

  const imports = ['import { z } from "zod";'];

  if (source.wireChecks.size > 0) {
    imports.push(
      `import { ${[...source.wireChecks].sort().join(", ")} } from "${relativeSpecifier(module, WIRE_CHECKS_MODULE)}";`,
    );
  }

  for (const namespace of source.namespaces) {
    imports.push(
      `import * as ${namespace.name} from "${relativeSpecifier(module, namespace.module)}";`,
    );
  }

  return `${[imports.join("\n"), ...source.declarations].join("\n\n")}\n`;
}

export function modulePath(module: string): string {
  return `${module}${MODULE_EXTENSION}`;
}

function relativeSpecifier(fromModule: string, toModule: string): string {
  const relative = posix.relative(posix.dirname(fromModule), toModule);
  const dotted = relative.startsWith("../") ? relative : `./${relative}`;

  return `${dotted}.js`;
}
