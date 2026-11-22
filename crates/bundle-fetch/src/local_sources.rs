//! Refusing local sources on shared branches: `allowLocal` in the config, and the environment.

use crate::environment::Environment;

/// Whether a local git repository (`file:` or a path) may be fetched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LocalSourcePolicy {
    /// Local repositories are fetched.
    Allow,
    /// Local repositories are refused.
    Refuse,
}

/// The variable whose value `false` forces the refusal; no other value lifts a refusal the config holds.
pub const ALLOW_LOCAL_VARIABLE: &str = "SEAMPACT_ALLOW_LOCAL";

const FORCED_REFUSAL: &str = "false";

fn is_forced_refusal(env: &Environment) -> bool {
    env.get(ALLOW_LOCAL_VARIABLE)
        .is_some_and(|value| value == FORCED_REFUSAL)
}

/// The policy of a config whose `allowLocal` is `configured`, under the environment `env`.
#[must_use]
pub fn local_source_policy(configured: Option<bool>, env: &Environment) -> LocalSourcePolicy {
    if is_forced_refusal(env) || configured == Some(false) {
        return LocalSourcePolicy::Refuse;
    }

    LocalSourcePolicy::Allow
}

/// What names the refusal in a message: the variable when it forced it, else the config key.
#[must_use]
pub fn local_source_refusal_reason(env: &Environment) -> String {
    if is_forced_refusal(env) {
        return format!("{ALLOW_LOCAL_VARIABLE}={FORCED_REFUSAL}");
    }

    "allowLocal: false".to_owned()
}
