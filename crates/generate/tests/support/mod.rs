//! The test result and the entry settings the run planning tests build on.

use seampact_cli_config::TargetEntrySettings;

pub type TestResult<Value> = Result<Value, Box<dyn std::error::Error>>;

pub fn settings(text: &str) -> TestResult<TargetEntrySettings> {
    Ok(serde_json::from_str(text)?)
}
