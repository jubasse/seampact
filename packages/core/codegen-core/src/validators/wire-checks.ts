// The generated checks the validators share: the code point counter and the `date-time` check.
export const CODE_POINT_LENGTH = "codePointLength";
export const IS_DATE_TIME = "isDateTime";

export type WireCheck = typeof CODE_POINT_LENGTH | typeof IS_DATE_TIME;

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

// The `8-4-4-4-12` hex layout of ADR 0003 section 8, in either case. A library's own uuid check may also test the
// RFC 9562 version and variant digits, which the contract does not.
export const UUID_LAYOUT =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
