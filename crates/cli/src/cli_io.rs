//! What a command reads and writes besides files: the working directory, the two output streams,
//! the environment and today; the one module that writes to the process streams.

use std::io::Write as _;
use std::time::{SystemTime, UNIX_EPOCH};

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli_config::{CliIo, CliProblem, print_problems};

/// The exit code of a command that wrote everything.
pub const EXIT_SUCCESS: i32 = 0;

/// The exit code of a refusal or a compile error.
pub const EXIT_REFUSED: i32 = 1;

/// The exit code of a usage error.
pub const EXIT_USAGE: i32 = 2;

/// Prints the problems of a refusal and answers the refusal exit code.
pub(crate) fn refuse(io: &mut dyn CliIo, problems: &[CliProblem]) -> i32 {
    print_problems(io, problems);

    EXIT_REFUSED
}

/// The process: its working directory, streams, environment and the UTC date of the system clock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessIo {
    cwd: Utf8PathBuf,
}

impl ProcessIo {
    /// The process with `cwd` as its working directory.
    #[must_use]
    pub fn new(cwd: Utf8PathBuf) -> Self {
        Self { cwd }
    }
}

impl CliIo for ProcessIo {
    fn cwd(&self) -> &Utf8Path {
        &self.cwd
    }

    // A closed stream drops the text, as Node's `process.stdout.write` does once the pipe closes.
    fn stdout(&mut self, text: &str) {
        let _ = std::io::stdout().write_all(text.as_bytes());
    }

    fn stderr(&mut self, text: &str) {
        let _ = std::io::stderr().write_all(text.as_bytes());
    }

    fn environment_variable(&self, name: &str) -> Option<String> {
        std::env::var_os(name).map(|value| value.to_string_lossy().into_owned())
    }

    fn today(&self) -> String {
        // A clock before 1970 reads as the epoch, as no date before it reaches a diff.
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs());

        utc_date_of(seconds)
    }
}

/// The seconds in one day.
const SECONDS_PER_DAY: u64 = 86_400;

/// The UTC date `YYYY-MM-DD` of `seconds` after the Unix epoch, as `toISOString().slice(0, 10)`
/// reads it (the civil-from-days algorithm of the proleptic Gregorian calendar).
fn utc_date_of(seconds: u64) -> String {
    let days = seconds / SECONDS_PER_DAY;
    let shifted_days = days + 719_468;
    let era = shifted_days / 146_097;
    let day_of_era = shifted_days % 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + u64::from(month <= 2);

    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_follow_the_gregorian_calendar() {
        let cases = [
            (0, "1970-01-01"),
            (951_782_400, "2000-02-29"),
            (1_767_225_599, "2025-12-31"),
            (1_767_225_600, "2026-01-01"),
            (4_107_542_400, "2100-03-01"),
        ];

        for (seconds, expected) in cases {
            assert_eq!(utc_date_of(seconds), expected, "seconds {seconds}");
        }
    }
}
