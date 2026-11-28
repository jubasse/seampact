//! A server route outside the contract that the boot check accepts.

use serde::Deserialize;

/// The HTTP methods a framework route entry names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    /// `GET`.
    Get,
    /// `HEAD`.
    Head,
    /// `POST`.
    Post,
    /// `PUT`.
    Put,
    /// `PATCH`.
    Patch,
    /// `DELETE`.
    Delete,
    /// `OPTIONS`.
    Options,
}

impl HttpMethod {
    /// The method as the config and the generators write it: upper case.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Head => "HEAD",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Patch => "PATCH",
            Self::Delete => "DELETE",
            Self::Options => "OPTIONS",
        }
    }
}

/// A path or pattern, for one method or every method, with its reason.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct FrameworkRouteEntry {
    /// The method; every method when absent.
    #[serde(default)]
    pub method: Option<HttpMethod>,
    /// The path or pattern.
    pub path: String,
    /// Why the route exists.
    pub reason: String,
}
