//! The boot checks a server target generates and an app config entry tunes (ADR 0012).

use serde::{Deserialize, Serialize};

/// One `frameworkRoutes` entry: a path or a pattern, an optional method, and why it is allowed.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameworkRouteAllowance {
    /// The HTTP method, when the entry names one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// The path or pattern (`*` one segment, `**` any number).
    pub path: String,
    /// Why the route is outside the contract.
    pub reason: String,
}

/// Which app routes the check reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameworkRouteScope {
    /// The routes that can serve a path under one of the contract's mounted base paths.
    Contract,
    /// Every app route.
    Strict,
}

/// Whether the entry wrote `artefacts.bootCheck.frameworkRoutes` or left the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RouteCheckOrigin {
    /// The entry leaves the default.
    Default,
    /// The entry writes the key.
    Written,
}

/// The framework-route check as the entry asks it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum FrameworkRouteCheck {
    /// On, with its allow-list.
    On {
        /// The allowed routes outside the contract.
        allowed: Vec<FrameworkRouteAllowance>,
        /// Which routes the check reads.
        scope: FrameworkRouteScope,
        /// Whether the entry wrote the switch.
        origin: RouteCheckOrigin,
    },
    /// Off.
    Off,
}

impl FrameworkRouteCheck {
    /// The check of an entry that writes neither key: on, nothing allowed, over the contract.
    pub const DEFAULT: Self = Self::On {
        allowed: Vec::new(),
        scope: FrameworkRouteScope::Contract,
        origin: RouteCheckOrigin::Default,
    };
}

/// The TypeScript's shape: `{ "status": "on", "allowed", "scope", "written"?: true }` or
/// `{ "status": "off" }`.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum FrameworkRouteCheckJson<'check> {
    On {
        allowed: &'check [FrameworkRouteAllowance],
        scope: FrameworkRouteScope,
        #[serde(skip_serializing_if = "Option::is_none")]
        written: Option<bool>,
    },
    Off,
}

impl Serialize for FrameworkRouteCheck {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let json = match self {
            Self::On {
                allowed,
                scope,
                origin,
            } => FrameworkRouteCheckJson::On {
                allowed,
                scope: *scope,
                written: (*origin == RouteCheckOrigin::Written).then_some(true),
            },
            Self::Off => FrameworkRouteCheckJson::Off,
        };

        json.serialize(serializer)
    }
}

/// The mount of an entry that writes none: every contract route at its contract path.
pub const NO_MOUNT: &str = "";

/// The boot checks a target generates that an app config entry may tune.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TunableBootCheck {
    /// `artefacts.bootCheck.frameworkRoutes`.
    FrameworkRoutes,
    /// `artefacts.bootCheck.hooks`.
    Hooks,
}

impl TunableBootCheck {
    /// The key as the app config writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::FrameworkRoutes => "frameworkRoutes",
            Self::Hooks => "hooks",
        }
    }
}

/// How the boot check treats a hook the contract needs and the app did not register.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HookBootCheck {
    /// Refuses to boot; the default.
    #[default]
    Error,
    /// Boots and logs each problem.
    Warn,
    /// Boots silently.
    Off,
}

impl HookBootCheck {
    /// The level as the app config writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warn => "warn",
            Self::Off => "off",
        }
    }
}
