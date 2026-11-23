//! The strictest of several `checks` levels, which governs a directory several plans write.

use seampact_cli_config::CheckLevel;

/// The strictest of `levels`; `disabled` when there is none.
#[must_use]
pub fn strictest_level(levels: &[CheckLevel]) -> CheckLevel {
    levels.iter().copied().max().unwrap_or(CheckLevel::Disabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_wins_over_warning_and_nothing_is_disabled() {
        assert_eq!(strictest_level(&[]), CheckLevel::Disabled);
        assert_eq!(
            strictest_level(&[CheckLevel::Warning, CheckLevel::Disabled]),
            CheckLevel::Warning
        );
        assert_eq!(
            strictest_level(&[CheckLevel::Warning, CheckLevel::Error, CheckLevel::Disabled]),
            CheckLevel::Error
        );
    }
}
