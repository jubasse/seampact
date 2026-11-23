//! The `artefacts` an app config entry switches, as the config writes them.

use indexmap::IndexMap;
use serde::Deserialize;

/// How the boot check treats a hook the contract needs and the app did not register.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HookBootCheckLevel {
    /// The boot fails (the default).
    Error,
    /// The boot warns.
    Warn,
    /// The check is skipped.
    Off,
}

/// The `bootCheck.frameworkRoutes` value: a flag, or `strict`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(untagged)]
pub enum FrameworkRoutesSwitch {
    /// `true` checks the app routes under the contract's base paths, `false` none.
    Flag(bool),
    /// `strict` checks every app route.
    Strict(StrictRouteCheck),
}

/// The one word `strict` of [`FrameworkRoutesSwitch`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StrictRouteCheck {
    /// `strict`.
    Strict,
}

/// The object form of `bootCheck`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootCheckSwitches {
    /// The framework route check.
    #[serde(default)]
    pub framework_routes: Option<FrameworkRoutesSwitch>,
    /// The hook check level.
    #[serde(default)]
    pub hooks: Option<HookBootCheckLevel>,
}

/// One artefact switch: on or off, or `bootCheck`'s object form.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
#[serde(untagged)]
pub enum ArtefactSwitch {
    /// On or off.
    Flag(bool),
    /// `bootCheck` taken apart; the artefact stays on.
    BootCheck(BootCheckSwitches),
}

/// The switches by artefact id, in the order the config writes them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct ArtefactSwitches(pub IndexMap<String, ArtefactSwitch>);
