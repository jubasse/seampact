//! The release-asset channel: the bundle tarball downloaded over HTTPS.
//!
//! A bundle comes from the network, so the URL and every redirect must be `https:`, redirects are
//! bounded, the download has a deadline, and it stops at the archive cap; the archive reader then
//! checks the bytes.

use std::io::{ErrorKind, Read};
use std::time::{Duration, Instant};

use seampact_bundle::{BUNDLE_ARCHIVE_BYTES_MAX, BundleFailureCode};
use seampact_bundle_source::ReleaseBundleSource;
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

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::VecDeque;
    use std::io::{self, Cursor};

    use super::*;

    /// Answers each request from a queue and records the URLs and timeouts it was asked for.
    struct RecordedGet {
        answers: RefCell<VecDeque<Result<ReleaseResponse, ReleaseGetError>>>,
        requested: RefCell<Vec<(String, Duration)>>,
    }

    impl RecordedGet {
        fn new(answers: Vec<Result<ReleaseResponse, ReleaseGetError>>) -> Self {
            Self {
                answers: RefCell::new(answers.into()),
                requested: RefCell::new(Vec::new()),
            }
        }

        fn urls(&self) -> Vec<String> {
            self.requested
                .borrow()
                .iter()
                .map(|(url, _)| url.clone())
                .collect()
        }
    }

    impl ReleaseGet for RecordedGet {
        fn get(&self, url: &Url, timeout: Duration) -> Result<ReleaseResponse, ReleaseGetError> {
            self.requested
                .borrow_mut()
                .push((url.as_str().to_owned(), timeout));

            self.answers
                .borrow_mut()
                .pop_front()
                .unwrap_or_else(|| Err(ReleaseGetError::Failed("no recorded answer".to_owned())))
        }
    }

    fn body(bytes: &[u8]) -> ReleaseResponse {
        ReleaseResponse {
            status: HTTP_OK,
            location: None,
            body: Box::new(Cursor::new(bytes.to_vec())),
        }
    }

    fn redirect(status: u16, location: &str) -> ReleaseResponse {
        ReleaseResponse {
            status,
            location: Some(location.to_owned()),
            body: Box::new(io::empty()),
        }
    }

    fn status(status: u16) -> ReleaseResponse {
        ReleaseResponse {
            status,
            location: None,
            body: Box::new(io::empty()),
        }
    }

    fn source(url: &str) -> ReleaseBundleSource {
        ReleaseBundleSource {
            url: url.to_owned(),
        }
    }

    fn failure_message(tarball: ReleaseTarball) -> String {
        match tarball {
            ReleaseTarball::Failed(failure) => failure.message,
            ReleaseTarball::Bytes(bytes) => panic!("expected a failure, got {} bytes", bytes.len()),
        }
    }

    #[test]
    fn a_url_that_is_not_absolute_https_is_refused_before_any_request() {
        for written in [
            "http://h/x.tgz",
            "ftp://h/x.tgz",
            "/x.tgz",
            "x.tgz",
            "https:/",
            "",
        ] {
            let problem = release_source_problem(&source(written));

            assert_eq!(
                problem.map(|failure| failure.code),
                Some(BundleSourceFailureCode::ReleaseUrl),
                "url {written:?}"
            );
        }

        assert_eq!(release_source_problem(&source("https://h/x.tgz")), None);
    }

    #[test]
    fn the_refusal_prints_the_url_without_its_token() {
        let problem = release_source_problem(&source("http://u:SECRET@h/x.tgz?t=S2"));

        assert_eq!(
            problem.map(|failure| failure.message),
            Some("The release URL 'http://h/x.tgz' is not an absolute https: URL.".to_owned())
        );
    }

    #[test]
    fn a_200_answer_gives_its_body() {
        let get = RecordedGet::new(vec![Ok(body(b"tarball"))]);

        assert_eq!(
            download_release_tarball(&source("https://h/x.tgz"), &get),
            ReleaseTarball::Bytes(b"tarball".to_vec())
        );
    }

    #[test]
    fn a_redirect_is_followed_against_the_url_it_came_from() {
        let get = RecordedGet::new(vec![
            Ok(redirect(302, "/moved/x.tgz")),
            Ok(redirect(307, "https://cdn.example/y.tgz")),
            Ok(body(b"ok")),
        ]);
        let tarball = download_release_tarball(&source("https://h/x.tgz"), &get);

        assert_eq!(tarball, ReleaseTarball::Bytes(b"ok".to_vec()));
        assert_eq!(
            get.urls(),
            [
                "https://h/x.tgz",
                "https://h/moved/x.tgz",
                "https://cdn.example/y.tgz"
            ]
        );
    }

    #[test]
    fn a_redirect_to_another_scheme_is_refused_with_the_printable_location() {
        let get = RecordedGet::new(vec![Ok(redirect(301, "http://u:SECRET@h/y.tgz?t=S2"))]);

        assert_eq!(
            failure_message(download_release_tarball(&source("https://h/x.tgz"), &get)),
            "Downloading the bundle from 'https://h/x.tgz' redirected to 'http://h/y.tgz', which is not an https: URL."
        );
    }

    #[test]
    fn five_redirects_are_followed_and_a_sixth_is_refused() {
        let five = (0..REDIRECTS_MAX)
            .map(|_| Ok(redirect(302, "/next")))
            .chain([Ok(body(b"ok"))])
            .collect();
        let six = (0..=REDIRECTS_MAX)
            .map(|_| Ok(redirect(302, "/next")))
            .chain([Ok(body(b"ok"))])
            .collect();

        assert_eq!(
            download_release_tarball(&source("https://h/x.tgz"), &RecordedGet::new(five)),
            ReleaseTarball::Bytes(b"ok".to_vec())
        );
        assert_eq!(
            failure_message(download_release_tarball(
                &source("https://h/x.tgz"),
                &RecordedGet::new(six)
            )),
            "Downloading the bundle from 'https://h/next' redirected more than 5 times."
        );
    }

    #[test]
    fn a_status_other_than_200_is_refused_and_a_redirect_without_location_counts_as_one() {
        for answer in [status(404), status(302)] {
            let code = answer.status;
            let get = RecordedGet::new(vec![Ok(answer)]);

            assert_eq!(
                failure_message(download_release_tarball(&source("https://h/x.tgz"), &get)),
                format!("Downloading the bundle from 'https://h/x.tgz' answered HTTP {code}."),
            );
        }
    }

    #[test]
    fn a_body_past_the_archive_cap_is_refused_with_the_cap() {
        let oversized = ReleaseResponse {
            status: HTTP_OK,
            location: None,
            body: Box::new(io::repeat(0).take(BUNDLE_ARCHIVE_BYTES_MAX as u64 + 1)),
        };
        let get = RecordedGet::new(vec![Ok(oversized)]);
        let ReleaseTarball::Failed(failure) =
            download_release_tarball(&source("https://h/x.tgz"), &get)
        else {
            panic!("an oversized body is refused");
        };

        assert_eq!(
            failure.code,
            BundleSourceFailureCode::Bundle(BundleFailureCode::ArchiveTooLarge)
        );
        assert_eq!(failure.expected.as_deref(), Some("67108864"));
        assert!(
            failure
                .message
                .starts_with("The release tarball holds more than 67108864 bytes ("),
            "message {:?}",
            failure.message
        );
    }

    #[test]
    fn a_body_exactly_at_the_cap_is_kept() {
        let at_cap = ReleaseResponse {
            status: HTTP_OK,
            location: None,
            body: Box::new(io::repeat(7).take(BUNDLE_ARCHIVE_BYTES_MAX as u64)),
        };
        let get = RecordedGet::new(vec![Ok(at_cap)]);

        assert!(matches!(
            download_release_tarball(&source("https://h/x.tgz"), &get),
            ReleaseTarball::Bytes(bytes) if bytes.len() == BUNDLE_ARCHIVE_BYTES_MAX
        ));
    }

    #[test]
    fn a_timeout_of_the_request_or_of_the_body_names_the_deadline() {
        let slow_body = ReleaseResponse {
            status: HTTP_OK,
            location: None,
            body: Box::new(TimedOutBody),
        };

        for answer in [Err(ReleaseGetError::TimedOut), Ok(slow_body)] {
            let get = RecordedGet::new(vec![answer]);

            assert_eq!(
                failure_message(download_release_tarball(&source("https://h/x.tgz"), &get)),
                "Downloading the bundle from 'https://h/x.tgz' took over 60000 ms."
            );
        }
    }

    #[test]
    fn the_whole_chain_shares_one_deadline() {
        let get = RecordedGet::new(vec![Ok(redirect(302, "/next")), Ok(body(b"ok"))]);

        download_release_tarball(&source("https://h/x.tgz"), &get);

        let timeouts: Vec<Duration> = get
            .requested
            .borrow()
            .iter()
            .map(|(_, timeout)| *timeout)
            .collect();

        assert!(
            timeouts.iter().all(|timeout| *timeout <= DOWNLOAD_TIMEOUT),
            "timeouts {timeouts:?}"
        );
        assert!(timeouts[1] <= timeouts[0], "timeouts {timeouts:?}");
    }

    #[test]
    fn a_failed_request_prints_the_url_it_repeats_without_its_token() {
        let get = RecordedGet::new(vec![Err(ReleaseGetError::Failed(
            "connection refused by https://u:SECRET@h/x.tgz?t=S2".to_owned(),
        ))]);
        let message = failure_message(download_release_tarball(
            &source("https://u:SECRET@h/x.tgz?t=S2"),
            &get,
        ));

        assert_eq!(
            message,
            "Downloading the bundle from 'https://h/x.tgz' failed: connection refused by https://h/x.tgz."
        );
    }

    /// A body whose read runs past the request's deadline.
    struct TimedOutBody;

    impl Read for TimedOutBody {
        fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::from(ErrorKind::TimedOut))
        }
    }
}
