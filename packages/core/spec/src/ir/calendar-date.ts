// A calendar date (grammar 04 l.3, ADR 0002 section 4): `YYYY-MM-DD` naming a day of the proleptic Gregorian
// calendar, years 0001 to 9999. The schema patterns admit `2026-02-30`; this check refuses it. The compiler refuses
// an authored date with it, and `ir.deprecation.since` an IR date.

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_IN_YEAR = 12;
const FEBRUARY = 2;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** True when `text` is `YYYY-MM-DD` and names a day that exists. */
export function isIrCalendarDate(text: string): boolean {
  const match = CALENDAR_DATE.exec(text);

  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1 || month < 1 || month > MONTHS_IN_YEAR || day < 1) return false;

  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  const days = DAYS_IN_MONTH[month - 1] ?? 0;

  return month === FEBRUARY && isLeapYear(year) ? days + 1 : days;
}

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
