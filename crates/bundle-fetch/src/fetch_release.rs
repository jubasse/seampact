//! The release-asset channel: the bundle tarball downloaded over HTTPS.
//!
//! A bundle comes from the network, so the URL and every redirect must be `https:`, redirects are
//! bounded, the download has a deadline, and it stops at the archive cap; the archive reader then
//! checks the bytes.

use std::io::{ErrorKind, Read};
use std::time::{Duration, Instant};

use seampact_bundle::{BUNDLE_ARCHIVE_BYTES_MAX, BundleFailureCode, ReleaseBundleSource};
use seampact_diagnostics::quote_text;
use url::Url;

use crate::printable_url::{printable_url, with_printable_url};
use crate::release_get::{ReleaseGet, ReleaseGetError, ReleaseResponse};
use crate::{BundleSourceFailure, BundleSourceFailureCode};

const HTTPS_SCHEME: &str = "https";
const REDIRECTS_MAX: u32 = 5;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_millis(60_000);
const HTTP_OK: u16 = 200;
const REDIRECT_STATUSES: [u16; 5] = [301, 302, 303, 307, 308];
const READ_CHUNK_BYTES: usize = 64 * 1024;

const RELEASE_FIX: &str =
    "Check the release URL and that the asset is reachable over HTTPS, then run again.";

/// The tarball's bytes, or why it cannot be downloaded.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ReleaseTarball {
    /// The downloaded bytes.
    Bytes(Vec<u8>),
    /// Why the download failed.
    Failed(BundleSourceFailure),
}

/// Why the source's URL cannot be downloaded from, before any request or cache read.
pub(crate) fn release_source_problem(source: &ReleaseBundleSource) -> Option<BundleSourceFailure> {
    match https_url(&source.url) {
        Some(_) => None,
        None => Some(not_https_url(&source.url)),
    }
}

/// Downloads the tarball of `source` through `get`, following at most five redirects within one
/// 60 s deadline.
pub(crate) fn download_release_tarball(
    source: &ReleaseBundleSource,
    get: &dyn ReleaseGet,
) -> ReleaseTarball {
    let Some(url) = https_url(&source.url) else {
        return ReleaseTarball::Failed(not_https_url(&source.url));
    };

    download(get, &url, REDIRECTS_MAX, Instant::now())
}

fn https_url(text: &str) -> Option<Url> {
    Url::parse(text)
        .ok()
        .filter(|url| url.scheme() == HTTPS_SCHEME)
}

fn not_https_url(text: &str) -> BundleSourceFailure {
    BundleSourceFailure::new(
        BundleSourceFailureCode::ReleaseUrl,
        format!(
            "The release URL {} is not an absolute https: URL.",
            quote_text(&printable_url(text))
        ),
        "Name the bundle tarball by its https: URL.",
    )
}

fn download(
    get: &dyn ReleaseGet,
    url: &Url,
    redirects_left: u32,
    started: Instant,
) -> ReleaseTarball {
    let remaining = DOWNLOAD_TIMEOUT.saturating_sub(started.elapsed());
    let response = match get.get(url, remaining) {
        Ok(response) => response,
        Err(ReleaseGetError::TimedOut) => return timed_out(url),
        Err(ReleaseGetError::Failed(message)) => return request_failed(url, &message),
    };

    if let Some(location) = redirect_location(&response) {
        return redirected(get, url, location, redirects_left, started);
    }

    if response.status != HTTP_OK {
        return ReleaseTarball::Failed(release_failed(
            url,
            &format!("answered HTTP {}", response.status),
        ));
    }

    read_body(url, response.body)
}

fn redirect_location(response: &ReleaseResponse) -> Option<&str> {
    if REDIRECT_STATUSES.contains(&response.status) {
        return response.location.as_deref();
    }

    None
}

/// Reads the body, stopping at the archive cap.
fn read_body(url: &Url, mut body: Box<dyn Read + Send>) -> ReleaseTarball {
    let mut bytes: Vec<u8> = Vec::new();
    let mut chunk = vec![0_u8; READ_CHUNK_BYTES];

    loop {
        let read = match body.read(&mut chunk) {
            Ok(0) => return ReleaseTarball::Bytes(bytes),
            Ok(read) => read,
            Err(error) if error.kind() == ErrorKind::TimedOut => return timed_out(url),
            Err(error) => return request_failed(url, &error.to_string()),
        };
        let received = bytes.len().saturating_add(read);

        if received > BUNDLE_ARCHIVE_BYTES_MAX {
            return ReleaseTarball::Failed(too_large(received));
        }

        bytes.extend(chunk.iter().take(read));
    }
}

fn timed_out(url: &Url) -> ReleaseTarball {
    ReleaseTarball::Failed(release_failed(
        url,
        &format!("took over {} ms", DOWNLOAD_TIMEOUT.as_millis()),
    ))
}

fn request_failed(url: &Url, message: &str) -> ReleaseTarball {
    ReleaseTarball::Failed(release_failed(
        url,
        &format!("failed: {}", with_printable_url(message, url.as_str())),
    ))
}

fn redirected(
    get: &dyn ReleaseGet,
    from: &Url,
    location: &str,
    redirects_left: u32,
    started: Instant,
) -> ReleaseTarball {
    if redirects_left == 0 {
        return ReleaseTarball::Failed(release_failed(
            from,
            &format!("redirected more than {REDIRECTS_MAX} times"),
        ));
    }

    let target = from
        .join(location)
        .ok()
        .filter(|target| target.scheme() == HTTPS_SCHEME);

    match target {
        Some(target) => download(get, &target, redirects_left - 1, started),
        None => ReleaseTarball::Failed(release_failed(
            from,
            &format!(
                "redirected to {}, which is not an https: URL",
                quote_text(&printable_url(location))
            ),
        )),
    }
}

fn release_failed(url: &Url, what: &str) -> BundleSourceFailure {
    BundleSourceFailure::new(
        BundleSourceFailureCode::ReleaseFailed,
        format!(
            "Downloading the bundle from {} {what}.",
            quote_text(&printable_url(url.as_str()))
        ),
        RELEASE_FIX,
    )
}

fn too_large(received: usize) -> BundleSourceFailure {
    BundleSourceFailure::new(
        BundleSourceFailureCode::Bundle(BundleFailureCode::ArchiveTooLarge),
        format!(
            "The release tarball holds more than {BUNDLE_ARCHIVE_BYTES_MAX} bytes ({received} received), over the cap."
        ),
        "Check that the source names a seampact bundle; a bundle this large is not one.",
    )
    .expecting(BUNDLE_ARCHIVE_BYTES_MAX.to_string())
}
