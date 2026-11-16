//! IR calendar dates (grammar 04, ADR 0002 section 4): `YYYY-MM-DD` naming a day of the proleptic
//! Gregorian calendar, years 0001 to 9999. The schema patterns admit `2026-02-30`; this check
//! refuses it.

/// The length of `YYYY-MM-DD`.
const CALENDAR_DATE_LENGTH: usize = 10;

/// The byte positions of the two `-` separators.
const SEPARATOR_POSITIONS: [usize; 2] = [4, 7];

const MONTHS_IN_YEAR: u32 = 12;

const FEBRUARY: u32 = 2;

/// The days of each month in a common year, January first.
const DAYS_IN_MONTH: [u32; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/// Whether `text` is `YYYY-MM-DD` in ASCII digits and names a day that exists.
#[must_use]
pub fn is_ir_calendar_date(text: &str) -> bool {
    let Some((year, month, day)) = calendar_date_fields(text) else {
        return false;
    };

    if year < 1 || !(1..=MONTHS_IN_YEAR).contains(&month) || day < 1 {
        return false;
    }

    day <= days_in_month(year, month)
}

// The year, month and day of a text shaped `YYYY-MM-DD`, read as numbers.
fn calendar_date_fields(text: &str) -> Option<(u32, u32, u32)> {
    let bytes = text.as_bytes();

    if bytes.len() != CALENDAR_DATE_LENGTH {
        return None;
    }

    let shaped = bytes.iter().enumerate().all(|(position, byte)| {
        if SEPARATOR_POSITIONS.contains(&position) {
            *byte == b'-'
        } else {
            byte.is_ascii_digit()
        }
    });

    if !shaped {
        return None;
    }

    let year = text.get(0..4)?.parse().ok()?;
    let month = text.get(5..7)?.parse().ok()?;
    let day = text.get(8..10)?.parse().ok()?;

    Some((year, month, day))
}

fn days_in_month(year: u32, month: u32) -> u32 {
    let days = usize::try_from(month)
        .ok()
        .and_then(|month| month.checked_sub(1))
        .and_then(|index| DAYS_IN_MONTH.get(index))
        .copied()
        .unwrap_or(0);

    if month == FEBRUARY && is_leap_year(year) {
        return days + 1;
    }

    days
}

const fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_day_that_exists_is_a_calendar_date() {
        for date in [
            "0001-01-01",
            "2026-01-31",
            "2026-04-30",
            "2026-12-31",
            "9999-12-31",
        ] {
            assert!(is_ir_calendar_date(date), "{date}");
        }
    }

    #[test]
    fn a_day_past_the_end_of_its_month_is_refused() {
        for date in [
            "2026-02-30",
            "2026-04-31",
            "2026-06-31",
            "2026-09-31",
            "2026-11-31",
        ] {
            assert!(!is_ir_calendar_date(date), "{date}");
        }
    }

    #[test]
    fn february_29_exists_in_leap_years_only() {
        assert!(is_ir_calendar_date("2024-02-29"));
        assert!(is_ir_calendar_date("2000-02-29"));
        assert!(is_ir_calendar_date("0004-02-29"));
        assert!(!is_ir_calendar_date("2026-02-29"));
        assert!(!is_ir_calendar_date("1900-02-29"));
        assert!(!is_ir_calendar_date("2100-02-29"));
    }

    #[test]
    fn year_month_or_day_zero_and_month_thirteen_are_refused() {
        for date in ["0000-01-01", "2026-00-10", "2026-13-01", "2026-01-00"] {
            assert!(!is_ir_calendar_date(date), "{date}");
        }
    }

    #[test]
    fn any_other_shape_is_refused() {
        for text in [
            "",
            "2026-1-01",
            "2026-01-1",
            "26-01-01",
            "12026-01-01",
            "2026/01/01",
            "2026-01-01T00:00:00Z",
            "2026-01-01\n",
            " 2026-01-01",
            "+026-01-01",
            "2026-0a-01",
        ] {
            assert!(!is_ir_calendar_date(text), "{text:?}");
        }
    }

    #[test]
    fn non_ascii_digits_are_refused() {
        // Arabic-Indic, fullwidth and Devanagari digits: `\d` without the `u` flag is ASCII only.
        for text in [
            "\u{0662}\u{0660}\u{0662}\u{0666}-01-01",
            "2026-\u{FF10}\u{FF11}-01",
            "2026-01-\u{0966}\u{0967}",
        ] {
            assert!(!is_ir_calendar_date(text), "{text:?}");
        }
    }
}
