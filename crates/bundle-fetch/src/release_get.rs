//! The HTTPS get of the release channel: the trait the channel reads through and its `ureq`
//! implementation.

use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

use ureq::Agent;
use ureq::http::header::LOCATION;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use url::Url;

/// What a GET answered: the status line and header the channel reads, and the body as a stream.
pub struct ReleaseResponse {
    /// The HTTP status code.
    pub status: u16,
    /// The `Location` header, when the answer holds one.
    pub location: Option<String>,
    /// The body; a read that runs past the request's timeout fails with
    /// [`ErrorKind::TimedOut`](std::io::ErrorKind::TimedOut).
    pub body: Box<dyn Read + Send>,
}

impl std::fmt::Debug for ReleaseResponse {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReleaseResponse")
            .field("status", &self.status)
            .field("location", &self.location)
            .finish_non_exhaustive()
    }
}

/// Why a GET gave no response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReleaseGetError {
    /// The request ran past its timeout.
    TimedOut,
    /// The request failed; what the client answered.
    Failed(String),
}

/// The HTTPS get of the release channel; production answers through `ureq`, tests from records.
///
/// An implementation follows no redirect and reads no proxy variable: the channel follows
/// redirects itself, with its own checks.
pub trait ReleaseGet {
    /// Requests `url` over HTTPS; the whole answer, body included, must end within `timeout`.
    ///
    /// # Errors
    ///
    /// [`ReleaseGetError`] when the request gives no response.
    fn get(&self, url: &Url, timeout: Duration) -> Result<ReleaseResponse, ReleaseGetError>;
}

/// The release channel's GET over `ureq` and `rustls`, against the operating system's roots.
#[derive(Debug, Clone, Copy, Default)]
pub struct UreqReleaseGet;

impl ReleaseGet for UreqReleaseGet {
    fn get(&self, url: &Url, timeout: Duration) -> Result<ReleaseResponse, ReleaseGetError> {
        let tls = TlsConfig::builder()
            .provider(TlsProvider::Rustls)
            .root_certs(RootCerts::PlatformVerifier)
            .unversioned_rustls_crypto_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .build();
        let config = Agent::config_builder()
            .https_only(true)
            .max_redirects(0)
            .max_redirects_will_error(false)
            .http_status_as_error(false)
            .proxy(None)
            .timeout_global(Some(timeout))
            .tls_config(tls)
            .build();
        let response = Agent::new_with_config(config)
            .get(url.as_str())
            .call()
            .map_err(|error| match error {
                ureq::Error::Timeout(_) => ReleaseGetError::TimedOut,
                other => ReleaseGetError::Failed(other.to_string()),
            })?;
        let status = response.status().as_u16();
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);

        Ok(ReleaseResponse {
            status,
            location,
            body: Box::new(response.into_body().into_reader()),
        })
    }
}
